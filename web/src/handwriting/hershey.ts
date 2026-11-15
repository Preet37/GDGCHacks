/**
 * A single-stroke font for characters the student hasn't written yet: Hershey Simplex Roman
 * (public domain, A. V. Hershey 1967), embedded as data so nothing is fetched at runtime.
 * Each entry is the classic "JHF" body for one ASCII character (32..126): pairs of letters, each
 * letter a coordinate as an offset from 'R'. The first pair is the left and right edge, " R" lifts the pen.
 * In these units y grows downwards, the baseline is y = 9, small letters reach y = -5, capitals y = -12.
 */
import type { Stroke } from './types'

const JHF: string[] = [
  "JZ",
  "MWRFRT RRYQZR[SZRY",
  "JZNFNM RVFVM",
  "H]SBLb RYBRb RLOZO RKUYU",
  "H\\PBP_ RTBT_ RYIWGTFPFMGKIKKLMMNOOUQWRXSYUYXWZT[P[MZKX",
  "F^[FI[ RNFPHPJOLMMKMIKIIJGLFNFPGSHVHYG[F RWTUUTWTYV[X[ZZ[X[VYTWT",
  "E_\\O\\N[MZMYNXPVUTXRZP[L[JZIYHWHUISJRQNRMSKSIRGPFNGMIMKNNPQUXWZY[[[\\Z\\Y",
  "MWRHQGRFSGSIRKQL",
  "KYVBTDRGPKOPOTPYR]T`Vb",
  "KYNBPDRGTKUPUTTYR]P`Nb",
  "JZRLRX RMOWU RWOMU",
  "E_RIR[ RIR[R",
  "NVSWRXQWRVSWSYQ[",
  "E_IR[R",
  "NVRVQWRXSWRV",
  "G][BIb",
  "H\\QFNGLJKOKRLWNZQ[S[VZXWYRYOXJVGSFQF",
  "H\\NJPISFS[",
  "H\\LKLJMHNGPFTFVGWHXJXLWNUQK[Y[",
  "H\\MFXFRNUNWOXPYSYUXXVZS[P[MZLYKW",
  "H\\UFKTZT RUFU[",
  "H\\WFMFLOMNPMSMVNXPYSYUXXVZS[P[MZLYKW",
  "H\\XIWGTFRFOGMJLOLTMXOZR[S[VZXXYUYTXQVOSNRNOOMQLT",
  "H\\YFO[ RKFYF",
  "H\\PFMGLILKMMONSOVPXRYTYWXYWZT[P[MZLYKWKTLRNPQOUNWMXKXIWGTFPF",
  "H\\XMWPURRSQSNRLPKMKLLINGQFRFUGWIXMXRWWUZR[P[MZLX",
  "NVROQPRQSPRO RRVQWRXSWRV",
  "NVROQPRQSPRO RSWRXQWRVSWSYQ[",
  "F^ZIJRZ[",
  "E_IO[O RIU[U",
  "F^JIZRJ[",
  "I[LKLJMHNGPFTFVGWHXJXLWNVORQRT RRYQZR[SZRY",
  "E`WNVLTKQKOLNMMPMSNUPVSVUUVS RQKOMNPNSOUPV RWKVSVUXVZV\\T]Q]O\\L[JYHWGTFQFNGLHJJILHOHRIUJWLYNZQ[T[WZYYZX RXKWSWUXV",
  "I[RFJ[ RRFZ[ RMTWT",
  "G\\KFK[ RKFTFWGXHYJYLXNWOTP RKPTPWQXRYTYWXYWZT[K[",
  "H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZV",
  "G\\KFK[ RKFRFUGWIXKYNYSXVWXUZR[K[",
  "H[LFL[ RLFYF RLPTP RL[Y[",
  "HZLFL[ RLFYF RLPTP",
  "H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZVZS RUSZS",
  "G]KFK[ RYFY[ RKPYP",
  "NVRFR[",
  "JZVFVVUYTZR[P[NZMYLVLT",
  "G\\KFK[ RYFKT RPOY[",
  "HYLFL[ RL[X[",
  "F^JFJ[ RJFR[ RZFR[ RZFZ[",
  "G]KFK[ RKFY[ RYFY[",
  "G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF",
  "G\\KFK[ RKFTFWGXHYJYMXOWPTQKQ",
  "G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF RSWY]",
  "G\\KFK[ RKFTFWGXHYJYLXNWOTPKP RRPY[",
  "H\\YIWGTFPFMGKIKKLMMNOOUQWRXSYUYXWZT[P[MZKX",
  "JZRFR[ RKFYF",
  "G]KFKULXNZQ[S[VZXXYUYF",
  "I[JFR[ RZFR[",
  "F^HFM[ RRFM[ RRFW[ R\\FW[",
  "H\\KFY[ RYFK[",
  "I[JFRPR[ RZFRP",
  "H\\YFK[ RKFYF RK[Y[",
  "KYOBOb RPBPb ROBVB RObVb",
  "KYKFY^",
  "KYTBTb RUBUb RNBUB RNbUb",
  "JZRDJR RRDZR",
  "I[Ib[b",
  "NVSKQMQORPSORNQO",
  "I\\XMX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  "H[LFL[ RLPNNPMSMUNWPXSXUWXUZS[P[NZLX",
  "I[XPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  "I\\XFX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  "I[LSXSXQWOVNTMQMONMPLSLUMXOZQ[T[VZXX",
  "MYWFUFSGRJR[ ROMVM",
  "I\\XMX]W`VaTbQbOa RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  "I\\MFM[ RMQPNRMUMWNXQX[",
  "NVQFRGSFREQF RRMR[",
  "MWRFSGTFSERF RSMS^RaPbNb",
  "IZMFM[ RWMMW RQSX[",
  "NVRFR[",
  "CaGMG[ RGQJNLMOMQNRQR[ RRQUNWMZM\\N]Q][",
  "I\\MMM[ RMQPNRMUMWNXQX[",
  "I\\QMONMPLSLUMXOZQ[T[VZXXYUYSXPVNTMQM",
  "H[LMLb RLPNNPMSMUNWPXSXUWXUZS[P[NZLX",
  "I\\XMXb RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  "KXOMO[ ROSPPRNTMWM",
  "J[XPWNTMQMNNMPNRPSUTWUXWXXWZT[Q[NZMX",
  "MYRFRWSZU[W[ ROMVM",
  "I\\MMMWNZP[S[UZXW RXMX[",
  "JZLMR[ RXMR[",
  "G]JMN[ RRMN[ RRMV[ RZMV[",
  "J[MMX[ RXMM[",
  "JZLMR[ RXMR[P_NaLbKb",
  "J[XMM[ RMMXM RM[X[",
  "KYTBRCQDPFPHQJRKSMSOQQ RRCQEQGRISJTLTNSPORSTTVTXSZR[Q]Q_Ra RQSSUSWRYQZP\\P^Q`RaTb",
  "NVRBRb",
  "KYPBRCSDTFTHSJRKQMQOSQ RRCSESGRIQJPLPNQPURQTPVPXQZR[S]S_Ra RSSQUQWRYSZT\\T^S`RaPb",
  "F^IUISJPLONOPPTSVTXTZS[Q RISJQLPNPPQTTVUXUZT[Q[O",
]

const BASELINE = 9
/** Height of a small letter (x) in Hershey units: everything is returned in x-heights. */
const X_HEIGHT = 14
/** Capitals and digits are this many x-heights tall in this font. */
export const FONT_CAP = 21 / X_HEIGHT

type Raw = { left: number; right: number; strokes: [number, number][][] }

/** Signs the ASCII set lacks, drawn in the same units (x from the glyph's centre, y down, baseline 9). */
const EXTRA: Record<string, Raw> = {
  '±': { left: -11, right: 11, strokes: [[[0, -12], [0, 2]], [[-8, -5], [8, -5]], [[-8, 7], [8, 7]]] },
  '×': { left: -9, right: 9, strokes: [[[-6, -5], [6, 7]], [[6, -5], [-6, 7]]] },
  '·': { left: -5, right: 5, strokes: [[[0, 0], [-1, 1], [0, 2], [1, 1], [0, 0]]] },
  '√': { left: -11, right: 12, strokes: [[[-9, 0], [-6, -2], [-1, 9], [4, -14], [12, -14]]] },
  '∫': { left: -9, right: 9, strokes: [[[6, -13], [5, -15], [3, -16], [1, -15], [0, -12], [-1, -4], [-1, 6], [-2, 13], [-3, 16], [-5, 17], [-7, 16], [-8, 14]]] },
  'π': { left: -11, right: 11, strokes: [[[-8, -4], [-6, -5], [8, -5]], [[-3, -5], [-4, 9]], [[4, -5], [4, 6], [5, 8], [7, 9]]] },
  '≠': { left: -13, right: 13, strokes: [[[-9, -3], [9, -3]], [[-9, 3], [9, 3]], [[5, -9], [-5, 9]]] },
  '≤': { left: -12, right: 12, strokes: [[[8, -10], [-8, -3], [8, 4]], [[-8, 9], [8, 9]]] },
  '≥': { left: -12, right: 12, strokes: [[[-8, -10], [8, -3], [-8, 4]], [[-8, 9], [8, 9]]] },
  '→': { left: -13, right: 13, strokes: [[[-9, 0], [9, 0]], [[4, -5], [9, 0], [4, 5]]] },
}

/** Other spellings of characters the font has. */
const SAME: Record<string, string> = { '−': '-', '–': '-', '′': "'", '’': "'", '∗': '*' }

function parse(body: string): Raw {
  const at = (i: number) => body.charCodeAt(i) - 82
  const strokes: [number, number][][] = [[]]
  for (let i = 2; i + 1 < body.length; i += 2) {
    if (body[i] === ' ' && body[i + 1] === 'R') strokes.push([])
    else strokes[strokes.length - 1].push([at(i), at(i + 1)])
  }
  return { left: at(0), right: at(1), strokes: strokes.filter((s) => s.length > 0) }
}

export interface FontGlyph {
  /** pen strokes; x from the glyph's left edge, y from the baseline (up is negative), in x-heights */
  strokes: Stroke[]
  /** advance width in x-heights, including the font's own side bearings */
  advance: number
  /** left and right edge of the ink */
  inkLeft: number
  inkRight: number
}

const cache = new Map<string, FontGlyph | null>()

/** The font's glyph for `char`, or null if it has none (then the string can't be written by hand). */
export function fontGlyph(char: string): FontGlyph | null {
  const hit = cache.get(char)
  if (hit !== undefined) return hit
  const c = SAME[char] ?? char
  const code = c.codePointAt(0) ?? 0
  const raw = EXTRA[c] ?? (c.length === 1 && code > 32 && code < 127 ? parse(JHF[code - 32]) : null)
  let glyph: FontGlyph | null = null
  if (raw && raw.strokes.length) {
    const strokes = raw.strokes.map((s) => s.map(([x, y]) => ({ x: (x - raw.left) / X_HEIGHT, y: (y - BASELINE) / X_HEIGHT })))
    const xs = strokes.flat().map((p) => p.x)
    glyph = { strokes, advance: (raw.right - raw.left) / X_HEIGHT, inkLeft: Math.min(...xs), inkRight: Math.max(...xs) }
  }
  cache.set(char, glyph)
  return glyph
}
