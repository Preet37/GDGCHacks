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

export type ActionType = "circle" | "underline" | "note" | "figure" | "ask" | "speak" | "lesson" | "solution";

export interface FigureSpec {
  kind: "plot2d" | "surface3d" | "circuit" | "fbd" | "model3d";  // circuit / fbd / model3d: Part 2 (engineering). A page that doesn't know a kind ignores it
  expressions: string[];      // math.js syntax: "x^2 - 4", "sin(x)". surface3d: one expression in x and y. [] for circuit / fbd
  x_range: [number, number];  // [0, 1] for circuit / fbd (unused)
  y_range?: [number, number];
  x_log?: boolean;            // true = logarithmic x axis (x_range must be positive), e.g. frequency plots
  title?: string;
  circuit?: CircuitFigure;    // kind "circuit" only: filled in by server code from the read netlist + solve_circuit
  fbd?: FbdFigure;            // kind "fbd" only: filled in by server code from the read force diagram
  model3d?: Model3dFigure;    // kind "model3d" only: a structure to turn around and tap (cleaned by server code)
}

// ---- Engineering (Part 2): 3D models ----
// Any units, z is up. The page fits the whole model in view.

export type Vec3 = [number, number, number];

export type ModelMaterial =
  | "steel" | "concrete" | "stone" | "wood" | "carbon" | "rubber" | "glass" | "asphalt" | "aluminium" | "cable"
  | "paint" | "water" | "earth";

export interface ModelPart {
  id: string;
  name: string;               // "Main cable", "Left tower"
  shape: "box" | "cylinder" | "cone" | "sphere" | "member";
  at?: Vec3;                  // box / cylinder / cone / sphere: centre
  size?: Vec3;                // box: x, y, z extents; cylinder / cone: [r, r, length]; sphere: [r, r, r]; member: [radius, 0, 0]
  axis?: "x" | "y" | "z" | "-x" | "-y" | "-z";  // cylinder / cone: the length runs along it (default z; a cone points that way)
  rotate?: Vec3;              // box / cylinder / cone: extra turn in degrees about x, y, z
  start?: Vec3;               // member (beam, bar, cable): one end
  end?: Vec3;                 // member: the other end
  points?: Vec3[];            // member: a curved path (sagging cable, arch); start / end are its ends
  material?: ModelMaterial;   // how it looks
  color?: string;             // "#rrggbb": overrides the material's colour
  load: "tension" | "compression" | "bending" | "none";
  explain?: string;           // shown when the part is tapped: its job and the force it carries
}

export interface ModelLoad {
  at: Vec3;                   // where the force acts
  dir: Vec3;                  // its direction (any length)
  label: string;              // "Traffic", "Weight"
}

export interface Model3dFigure {
  parts: ModelPart[];
  loads?: ModelLoad[];
  summary?: string;           // one line under the title
}

// ---- Engineering (Part 2): circuits and free-body diagrams ----

export interface CircuitElement {
  id: string;                 // label from the drawing: "R1", "V1"
  kind: "resistor" | "vsource" | "isource";
  a: string;                  // node names; "0" is ground. vsource: V(a) - V(b) = value; isource: value amps a -> b
  b: string;
  value: string;              // as written: "4.7k", "9", "2mA"
  box?: Box;                  // where its symbol is drawn, 0-1000 over the sent image
}

export interface CircuitSolution {
  node_voltages: Record<string, number>;     // volts, measured from ground
  currents: Record<string, number>;          // amps, a -> b through each element
  element_voltages?: Record<string, number>; // V(a) - V(b) across each element
  power?: Record<string, number>;            // watts absorbed (sources come out negative)
}

export interface CircuitFigure {
  elements: CircuitElement[];
  nodes?: { id: string; at: [number, number] }[];  // [y, x] 0-1000: a point on each node's wire, for voltage labels
  solution?: CircuitSolution;                        // from solve_circuit
  reveal: boolean;            // false = show the elements, hide the numbers (the student hasn't answered yet)
}

export interface Force {
  id: string;
  label: string;              // "mg", "N", "f", "T"
  angle_deg: number;          // direction, degrees counter-clockwise from +x
  magnitude?: string;         // as written, if any: "19.6 N", "m*g"
  on: string;                 // body id
  at?: [number, number];      // [y, x] 0-1000: where the arrow starts
}

export interface FbdFigure {
  bodies: { id: string; shape: "box" | "point" | "beam"; at?: [number, number] }[];
  surfaces?: { id: string; angle_deg: number }[];  // a ramp at 30 degrees, a floor at 0
  forces: Force[];            // what the student drew
  expected?: Force[];         // what should be there; the page draws the missing ones dashed
}

// POST /api/circuit/solve (no Gemini): { elements: CircuitElement[] } -> CircuitSolveResponse
export interface CircuitSolveRequest {
  elements: CircuitElement[];
}
export type CircuitSolveResponse = ({ ok: true } & CircuitSolution & { ground_chosen?: string }) | { ok: false; detail: string };

export interface Action {
  type: ActionType;
  box?: Box;                  // circle/underline: what to mark. note/figure/ask: what to sit next to
  line_id?: string;           // the line this is about, if any
  color?: "red" | "green" | "blue" | "black";  // black = the tutor finishing a line in the student's ink colour
  text?: string;              // note/ask/speak. Plain words, inline math in $...$
  side?: "right" | "below" | "inline";  // inline (note only): written straight after the end of the line, at the handwriting's size
  options?: string[];         // ask: choices, e.g. ["x^2", "x_2"]
  figure?: FigureSpec;        // figure only
  lesson?: Lesson;            // lesson only: placed next to `box` like a figure
  steps?: string[];           // solution only: the worked steps, one LaTeX line each, written one under another
                              // below `box` at the handwriting's size. Only sent when the student asked for a full solve
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

export interface GivenLine {
  box: Box;                   // where it sits in the sent image
  latex: string;
  plain: string;
}

export interface CheckRequest {
  image_base64: string;       // PNG, longest side <= 1280 px
  mode: "auto" | "help" | "explain";  // auto = sent after a pause; help = Help tapped; explain = "Teach me" tapped
  help_box?: Box;             // help mode: area the user selected (missing = whole page)
  question?: string;          // help mode: what the student asked out loud, transcribed (missing = no question)
  given?: GivenLine[];        // problem statements the tutor itself wrote on the page (practice problems), so they need not be re-read
  has_worksheet?: boolean;    // false = no imported worksheet in the sent image, so every line is the student's handwriting.
                              // Missing = unknown (the reader decides)
  state: PageState;
}

export interface CheckResponse {
  lines: ReadLine[];
  actions: Action[];          // NEW or UPDATED feedback only. Actions with a line_id replace that line's old feedback
  clear_line_ids: string[];   // lines whose old feedback should be removed (fixed or erased)
  state: PageState;           // updated state for the page to save
  debug?: { model: string; read_ms: number; teach_ms: number; tool_calls: string[] };
}

// ---- Lessons: "Teach me". A short narrated, animated explanation the page plays next to the work. ----

export interface LessonMark {
  type: "point" | "tangent" | "secant" | "area" | "vline" | "hline" | "label";
  expr?: number;              // index into the visual's expressions (default 0)
  x?: number;                 // point/tangent/vline/label: where. secant/area: left end
  x2?: number;                // secant/area: right end
  y?: number;                 // hline/label
  to_x?: number;              // animate x from `x` to `to_x` while the step plays (a sliding tangent or point)
  to_x2?: number;             // animate x2 the same way (a secant closing in, an area growing)
  text?: string;              // label text, plain words
  color?: "red" | "green" | "blue" | "black";
}

export interface LessonVisual {
  kind: "plot2d" | "surface3d";
  expressions: string[];      // math.js syntax, same rules as FigureSpec
  x_range: [number, number];
  y_range?: [number, number];
  x_log?: boolean;            // true = logarithmic x axis (x_range must be positive)
  marks?: LessonMark[];       // drawn on top of the plot (plot2d only)
}

export interface LessonStep {
  say: string;                // narration, read aloud: plain spoken words, no LaTeX, no symbols
  write?: string;             // one line of math written out for this step, LaTeX
  caption?: string;           // short on-screen text, plain words with inline $math$
  visual?: LessonVisual;      // the picture for this step. Missing = keep the previous step's picture
}

export interface Practice {
  prompt: string;             // what to do, plain words: "Your turn: find the derivative."
  problem: string;            // a new problem of the same kind as the student's, one LaTeX line: "f(x) = x^3 - 5x"
  plain: string;              // the same line in calculator syntax
  ask?: string;               // optional LaTeX for the line the student completes: "f'(x) ="
}

export interface Lesson {
  title: string;
  steps: LessonStep[];        // 6 to 9 steps
  practice?: Practice;        // "Your turn": the page writes `problem` on the canvas after the lesson; the student's work under it is checked like any other
}

// ---- Handwriting: POST /api/glyphs. Finds each handwritten character so the page can learn the student's letter shapes. ----

export interface GlyphBox {
  char: string;               // one character as written: a digit, letter, operator or bracket ("x", "2", "=", "+", "(")
  box: Box;                   // tight box around that character, 0-1000 over the sent image
}

export interface GlyphsRequest {
  image_base64: string;       // PNG of handwriting only (no worksheet, no tutor marks), longest side <= 1280 px
}

export interface GlyphsResponse {
  glyphs: GlyphBox[];
}
