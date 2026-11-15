"""Pydantic models. Field-for-field match with contract/contract.ts. Change both together."""
from typing import Literal, Optional
from pydantic import BaseModel, Field

Box = tuple[int, int, int, int]  # [ymin, xmin, ymax, xmax], 0-1000 over the sent image

Relation = Literal["start", "equals", "simplify", "derivative", "integral", "solve", "other"]
ActionType = Literal["circle", "underline", "note", "figure", "ask", "speak", "lesson", "solution"]


class ReadLine(BaseModel):
    line_id: str
    problem_id: str
    latex: str
    plain: str
    box: Box
    relation: Relation
    confidence: Literal["high", "low"]
    source: Optional[Literal["handwriting", "printed"]] = None  # missing = handwriting


# ---- Engineering (Part 2): circuits and free-body diagrams (mirrors contract/contract.ts) ----

class CircuitElement(BaseModel):
    id: str
    kind: Literal["resistor", "vsource", "isource"]
    a: str
    b: str
    value: str
    box: Optional[Box] = None


class CircuitNode(BaseModel):
    id: str
    at: tuple[float, float]  # [y, x] 0-1000


class CircuitSolution(BaseModel):
    node_voltages: dict[str, float]
    currents: dict[str, float]
    element_voltages: Optional[dict[str, float]] = None
    power: Optional[dict[str, float]] = None


class CircuitFigure(BaseModel):
    elements: list[CircuitElement]
    nodes: Optional[list[CircuitNode]] = None
    solution: Optional[CircuitSolution] = None
    reveal: bool


class Force(BaseModel):
    id: str
    label: str
    angle_deg: float
    magnitude: Optional[str] = None
    on: str
    at: Optional[tuple[float, float]] = None


class FbdBody(BaseModel):
    id: str
    shape: Literal["box", "point", "beam"]
    at: Optional[tuple[float, float]] = None


class FbdSurface(BaseModel):
    id: str
    angle_deg: float


class FbdFigure(BaseModel):
    bodies: list[FbdBody]
    surfaces: Optional[list[FbdSurface]] = None
    forces: list[Force]
    expected: Optional[list[Force]] = None


class CircuitSolveRequest(BaseModel):
    elements: list[dict]  # loose on purpose: solve_circuit explains a bad element instead of a 422


Vec3 = tuple[float, float, float]


Material = Literal["steel", "concrete", "stone", "wood", "carbon", "rubber", "glass", "asphalt", "aluminium", "cable",
                   "paint", "water", "earth"]


class ModelPart(BaseModel):
    id: str
    name: str
    shape: Literal["box", "cylinder", "cone", "sphere", "member"]
    at: Optional[Vec3] = None      # box / cylinder / cone / sphere: centre
    size: Optional[Vec3] = None    # box: full x, y, z extents; cylinder / cone: [radius, radius, length]; sphere: [r, r, r]; member: [radius, 0, 0]
    axis: Optional[Literal["x", "y", "z", "-x", "-y", "-z"]] = None  # cylinder / cone: the length runs along it (default z; a cone points that way)
    rotate: Optional[Vec3] = None  # box / cylinder / cone: extra turn in degrees about x, y, z (a tilted wing)
    start: Optional[Vec3] = None   # member (a beam, bar, cable): one end
    end: Optional[Vec3] = None     # member: the other end
    points: Optional[list[Vec3]] = None  # member: a curved path (a sagging cable, an arch); start/end are its ends
    material: Optional[Material] = None  # how it looks
    color: Optional[str] = None    # "#rrggbb", overrides the material's colour (a team's paint)
    load: Literal["tension", "compression", "bending", "none"] = "none"
    explain: Optional[str] = None  # its job and the force it carries, one or two sentences


class ModelLoad(BaseModel):
    at: Vec3
    dir: Vec3
    label: str


class Model3dFigure(BaseModel):
    parts: list[ModelPart]         # [] = not built yet: the page asks POST /api/model3d for `subject`
    loads: list[ModelLoad] = Field(default_factory=list)
    summary: Optional[str] = None
    subject: Optional[str] = None  # what to build, e.g. "suspension bridge, 120 m main span"
    focus: Optional[str] = None    # what the student asked about, so the model shows it


class Model3dBuildRequest(BaseModel):
    subject: str
    focus: Optional[str] = None


class FigureSpec(BaseModel):
    kind: Literal["plot2d", "surface3d", "circuit", "fbd", "model3d"]
    expressions: list[str]
    x_range: tuple[float, float]
    y_range: Optional[tuple[float, float]] = None
    x_log: Optional[bool] = None
    title: Optional[str] = None
    circuit: Optional[CircuitFigure] = None
    fbd: Optional[FbdFigure] = None
    model3d: Optional[Model3dFigure] = None


Color = Literal["red", "green", "blue", "black"]


class LessonMark(BaseModel):
    type: Literal["point", "tangent", "secant", "area", "vline", "hline", "label"]
    expr: Optional[int] = None
    x: Optional[float] = None
    x2: Optional[float] = None
    y: Optional[float] = None
    to_x: Optional[float] = None
    to_x2: Optional[float] = None
    text: Optional[str] = None
    color: Optional[Color] = None


class LessonVisual(BaseModel):
    kind: Literal["plot2d", "surface3d"]
    expressions: list[str]
    x_range: tuple[float, float]
    y_range: Optional[tuple[float, float]] = None
    x_log: Optional[bool] = None
    marks: Optional[list[LessonMark]] = None


class LessonStep(BaseModel):
    say: str
    write: Optional[str] = None
    caption: Optional[str] = None
    visual: Optional[LessonVisual] = None


class Practice(BaseModel):
    prompt: str
    problem: str
    plain: str
    ask: Optional[str] = None


class Lesson(BaseModel):
    title: str
    steps: list[LessonStep]
    practice: Optional[Practice] = None


class Action(BaseModel):
    type: ActionType
    box: Optional[Box] = None
    line_id: Optional[str] = None
    color: Optional[Literal["red", "green", "blue", "black"]] = None
    text: Optional[str] = None
    side: Optional[Literal["right", "below", "inline"]] = None
    options: Optional[list[str]] = None
    figure: Optional[FigureSpec] = None
    lesson: Optional[Lesson] = None
    steps: Optional[list[str]] = None


class ProblemState(BaseModel):
    problem_id: str
    hint_level: Literal[0, 1, 2, 3] = 0


class PageState(BaseModel):
    page_id: str
    lines: list[ReadLine] = Field(default_factory=list)
    problems: list[ProblemState] = Field(default_factory=list)
    flagged_line_ids: list[str] = Field(default_factory=list)


class GivenLine(BaseModel):
    box: Box
    latex: str
    plain: str


class CheckRequest(BaseModel):
    image_base64: str
    mode: Literal["auto", "help", "explain"]
    help_box: Optional[Box] = None
    question: Optional[str] = None
    given: Optional[list[GivenLine]] = None
    has_worksheet: Optional[bool] = None
    state: PageState


class Debug(BaseModel):
    model: str
    read_ms: int
    teach_ms: int
    tool_calls: list[str]


class CheckResponse(BaseModel):
    lines: list[ReadLine]
    actions: list[Action]
    clear_line_ids: list[str] = Field(default_factory=list)
    state: PageState
    debug: Optional[Debug] = None


class GlyphBox(BaseModel):
    char: str
    box: Box


class GlyphsRequest(BaseModel):
    image_base64: str


class GlyphsResponse(BaseModel):
    glyphs: list[GlyphBox] = Field(default_factory=list)
