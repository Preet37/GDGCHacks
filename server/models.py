"""Pydantic models. Field-for-field match with contract/contract.ts. Change both together."""
from typing import Literal, Optional
from pydantic import BaseModel, Field

Box = tuple[int, int, int, int]  # [ymin, xmin, ymax, xmax], 0-1000 over the sent image

Relation = Literal["start", "equals", "simplify", "derivative", "integral", "solve", "other"]
ActionType = Literal["circle", "underline", "note", "figure", "ask", "speak"]


class ReadLine(BaseModel):
    line_id: str
    problem_id: str
    latex: str
    plain: str
    box: Box
    relation: Relation
    confidence: Literal["high", "low"]
    source: Optional[Literal["handwriting", "printed"]] = None  # missing = handwriting


class FigureSpec(BaseModel):
    kind: Literal["plot2d", "surface3d"]
    expressions: list[str]
    x_range: tuple[float, float]
    y_range: Optional[tuple[float, float]] = None
    title: Optional[str] = None


class Action(BaseModel):
    type: ActionType
    box: Optional[Box] = None
    line_id: Optional[str] = None
    color: Optional[Literal["red", "green", "blue", "black"]] = None
    text: Optional[str] = None
    side: Optional[Literal["right", "below", "inline"]] = None
    options: Optional[list[str]] = None
    figure: Optional[FigureSpec] = None


class ProblemState(BaseModel):
    problem_id: str
    hint_level: Literal[0, 1, 2, 3] = 0


class PageState(BaseModel):
    page_id: str
    lines: list[ReadLine] = Field(default_factory=list)
    problems: list[ProblemState] = Field(default_factory=list)
    flagged_line_ids: list[str] = Field(default_factory=list)


class CheckRequest(BaseModel):
    image_base64: str
    mode: Literal["auto", "help"]
    help_box: Optional[Box] = None
    question: Optional[str] = None
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
