"""Server-internal types shared by read.py, teach.py and pipeline.py. Not part of the public contract."""
from typing import Literal, Optional
from pydantic import BaseModel, Field
from models import Action

Verdict = Literal["correct", "incorrect", "unknown"]


class VerifyResult(BaseModel):
    verdict: Verdict
    detail: str


class HintUpdate(BaseModel):
    problem_id: str
    hint_level: Literal[0, 1, 2, 3]


class TeachResult(BaseModel):
    actions: list[Action] = Field(default_factory=list)
    clear_line_ids: list[str] = Field(default_factory=list)
    hint_updates: list[HintUpdate] = Field(default_factory=list)
    tool_calls: list[str] = Field(default_factory=list)       # e.g. 'verify_step(L1->L2, derivative) = incorrect'
    verdicts: dict[str, Verdict] = Field(default_factory=dict)  # line_id -> verdict from verify_step, for the guard
    finished: bool = True                                     # False if the 5-round limit was hit

# Interfaces (each file owned by one agent):
#   read.py     def read_page(client, model: str, image_png: bytes, prev_lines: list[ReadLine]) -> list[ReadLine]
#   teach.py    def teach(client, model: str, lines: list[ReadLine], req: CheckRequest) -> TeachResult
#   verify.py   def verify_step(before: str, after: str, relation: str) -> dict  # {"verdict", "detail"}
#   pipeline.py def run_check(req: CheckRequest) -> CheckResponse
