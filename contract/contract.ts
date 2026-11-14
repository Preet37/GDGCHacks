// contract/contract.ts
export type Box = [number, number, number, number]; // [ymin, xmin, ymax, xmax], 0-1000 over the sent image

export interface ReadLine {
  line_id: string;      // stable id like "L1"; reuse ids from state.lines when the same line is seen again
  problem_id: string;   // like "P1"; lines of one worked problem share it
  latex: string;        // what was read, as LaTeX, for display
  plain: string;        // same line in calculator syntax for checking, e.g. "f(x) = 3*x^2 + 2*x"
  box: Box;
  relation: "start" | "equals" | "simplify" | "derivative" | "integral" | "solve" | "other";
                        // how this line follows from the previous line of the same problem
  confidence: "high" | "low";
  source?: "handwriting" | "printed"; // printed = typed worksheet text (context only, never marked); missing = handwriting
}

export type ActionType = "circle" | "underline" | "note" | "figure" | "ask" | "speak";

export interface FigureSpec {
  kind: "plot2d" | "surface3d";
  expressions: string[];      // math.js syntax: "x^2 - 4", "sin(x)". surface3d: one expression in x and y
  x_range: [number, number];
  y_range?: [number, number];
  title?: string;
}

export interface Action {
  type: ActionType;
  box?: Box;                  // circle/underline: what to mark. note/figure/ask: what to sit next to
  line_id?: string;           // the line this is about, if any
  color?: "red" | "green" | "blue";
  text?: string;              // note/ask/speak. Plain words, inline math in $...$
  side?: "right" | "below";
  options?: string[];         // ask: choices, e.g. ["x^2", "x_2"]
  figure?: FigureSpec;        // figure only
}

export interface ProblemState {
  problem_id: string;
  hint_level: 0 | 1 | 2 | 3;  // 0 = no hints given yet, 3 = worked step shown
}

export interface PageState {
  page_id: string;
  lines: ReadLine[];          // last reading
  problems: ProblemState[];
  flagged_line_ids: string[]; // lines that currently have feedback on the page
}

export interface CheckRequest {
  image_base64: string;       // PNG, longest side <= 1280 px
  mode: "auto" | "help";      // auto = sent after a pause; help = user tapped Help
  help_box?: Box;             // help mode: area the user selected (missing = whole page)
  question?: string;          // help mode: what the student asked out loud, transcribed (missing = no question)
  state: PageState;
}

export interface CheckResponse {
  lines: ReadLine[];
  actions: Action[];          // NEW or UPDATED feedback only. Actions with a line_id replace that line's old feedback
  clear_line_ids: string[];   // lines whose old feedback should be removed (fixed or erased)
  state: PageState;           // updated state for the page to save
  debug?: { model: string; read_ms: number; teach_ms: number; tool_calls: string[] };
}
