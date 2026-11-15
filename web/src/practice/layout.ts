import { createShapeId, toRichText, type TLDefaultColorStyle, type TLShapeId, type TLShapePartial } from 'tldraw'
import type { Practice } from '../contract'
import { INLINE_LETTER_EM } from '../render/actions'
import {
  BASE_FONT,
  CHAR_EM,
  DEFAULT_CONTEXT,
  DEFAULT_LINE_H,
  MIN_SCREEN_FONT,
  TEXT_LINE_HEIGHT,
  clamp,
  feedbackSizes,
  letterHeight,
  slideBelow,
  type PageRect,
  type RenderContext,
} from '../render/geometry'
import { STEP_PITCH_EM, type Measure } from '../render/solution'
import { mathToPlain } from '../render/text'
import { latexToPlain, PRACTICE_KIND, type PracticeRole } from './kind'

/** Blank lines kept free under the problem for the student to write on. */
export const ROOM_LINES = 3
/** Blank space kept free to the right of the `ask` line, over the font size. */
export const ROOM_EM = 8

export interface PracticeLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface PracticeLayout {
  /** font size of the problem and ask lines, page units */
  font: number
  labelFont: number
  label: PracticeLine
  problem: PracticeLine
  ask?: PracticeLine
  /** everything it claims: the label, the lines and the room to write */
  rect: PageRect
}

const guess: Measure = (text, font) => text.length * font * CHAR_EM

/**
 * Where a practice problem goes: straight below `work` (the student's working on the problem the
 * lesson was about), left edges lined up, past anything in the way (ink, tutor feedback, printed
 * text), so it never lands on writing. From the top: the small "Your turn" label (the prompt), the
 * problem at the size of the student's own letters, the `ask` line if there is one with room to
 * its right, then blank lines to write on. The whole block is claimed in `ctx.taken`.
 */
export function practiceLayout(practice: Practice, work: PageRect, ctx: RenderContext = DEFAULT_CONTEXT, measure: Measure = guess): PracticeLayout {
  const zoom = ctx.zoom > 0 && Number.isFinite(ctx.zoom) ? ctx.zoom : 1
  const letters = letterHeight(work, ctx.ink)
  const sz = feedbackSizes(letters === null ? DEFAULT_LINE_H : letters * 1.4, ctx)
  // same rule as an answer the tutor writes on the student's line: letters as tall as theirs
  let font = letters === null ? sz.inlineFont : clamp(letters * INLINE_LETTER_EM, sz.inlineFont, sz.inlineFont * 1.5)
  const problemText = mathToPlain(practice.problem)
  const askText = practice.ask ? mathToPlain(practice.ask) : ''
  const widthAt = (f: number) => Math.max(measure(problemText, f), askText ? measure(askText, f) + ROOM_EM * f : 0)
  // too wide for the screen: written smaller (never below readable)
  const maxW = ctx.view ? ctx.view.w * 0.9 : Infinity
  if (widthAt(font) > maxW) font = Math.max(font * (maxW / widthAt(font)), Math.min(font, MIN_SCREEN_FONT / zoom))

  const labelFont = Math.min(font, sz.noteFont)
  const labelText = practice.prompt.trim() || 'Your turn.'
  const labelFull = measure(labelText, labelFont) + labelFont
  const labelW = Math.min(labelFull, Math.max(widthAt(font), ctx.view ? ctx.view.w * 0.8 : labelFont * 30))
  const labelH = Math.ceil(labelFull / labelW) * labelFont * TEXT_LINE_HEIGHT

  const lineH = font * TEXT_LINE_HEIGHT
  const pitch = font * STEP_PITCH_EM
  const w = Math.max(labelW, widthAt(font))
  const top = labelH + labelFont * 0.25
  const h = top + lineH + (askText ? pitch : 0) + (askText ? ROOM_LINES - 1 : ROOM_LINES) * pitch
  const gap = Math.max(sz.gap, font * 0.5)
  const obstacles = [...(ctx.ink ?? []), ...(ctx.taken ?? []), ...(ctx.printed ?? [])]
  const rect = slideBelow(work, w, h, gap, ctx, obstacles) ?? { x: work.x, y: work.y + work.h + gap, w, h }
  ctx.taken?.push(rect)

  const line = (text: string, y: number, f: number, width = measure(text, f), height = f * TEXT_LINE_HEIGHT): PracticeLine => ({ text, x: rect.x, y, w: width, h: height })
  return {
    font,
    labelFont,
    label: line(labelText, rect.y, labelFont, labelW, labelH),
    problem: line(problemText, rect.y + top, font),
    ...(askText ? { ask: line(askText, rect.y + top + pitch, font) } : {}),
    rect,
  }
}

type Shape = TLShapePartial & { x: number; y: number; id: TLShapeId }

/**
 * The text shapes of one practice problem, all tagged `kind: 'practice'` with the same
 * `practice_id` and carrying the Practice (so it survives a reload). The problem and ask lines
 * also carry their own `latex` and `plain`: that is what is sent as `given`.
 */
export function practiceShapes(practice: Practice, layout: PracticeLayout, practiceId: string, color: TLDefaultColorStyle = 'violet'): Shape[] {
  const meta = (role: PracticeRole, extra: Record<string, string> = {}) => ({
    ai: true,
    line_id: null,
    kind: PRACTICE_KIND,
    practice_id: practiceId,
    role,
    practice: JSON.stringify(practice),
    solved: false,
    ...extra,
  })
  const text = (l: PracticeLine, font: number, role: PracticeRole, extra?: Record<string, string>): Shape => {
    const scale = font / BASE_FONT
    return {
      id: createShapeId(),
      type: 'text',
      x: l.x,
      y: l.y,
      isLocked: true, // the eraser leaves the problem alone while the student rubs out their own working
      meta: meta(role, extra),
      props:
        role === 'label'
          ? { richText: toRichText(l.text), font: 'draw', size: 's', scale, color, textAlign: 'start', autoSize: false, w: l.w / scale }
          : { richText: toRichText(l.text), font: 'draw', size: 's', scale, color, textAlign: 'start', autoSize: true },
    }
  }
  const shapes = [text(layout.label, layout.labelFont, 'label'), text(layout.problem, layout.font, 'problem', { latex: practice.problem, plain: practice.plain || latexToPlain(practice.problem) })]
  if (layout.ask && practice.ask) shapes.push(text(layout.ask, layout.font, 'ask', { latex: practice.ask, plain: latexToPlain(practice.ask) }))
  return shapes
}
