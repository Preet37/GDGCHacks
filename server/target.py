"""Which line the student is pointing at. Geometry only: the same for any subject.

`help_box` is the area the student selected, or (when nothing is selected) the area of their most recent
ink: a line they just wrote, or an underline or circle drawn at one printed sub-problem.
"""
from models import ReadLine

NEAR = 150          # how far (0-1000 units) ink may sit from a line and still be pointing at it
BELOW_COST = 2.0    # an underline sits just below its target, so a line under the ink counts as further away
SIDE_COST = 0.5     # a mark beside a line, at its height, is closer to it than to the line above or below
MIN_SHARE = 0.25    # ink that only grazes a line (less than this share of the thinner one's height) is not on it


def _overlap(a, b) -> tuple[float, float]:
    """(height, width) of the overlap of two boxes; negative numbers are the gap between them."""
    return min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])


def _on(line_box, box) -> float:
    """The share of the line that the box covers (0 to 1) if the box really lies on the line, else 0."""
    h, w = _overlap(line_box, box)
    if h <= 0 or w <= 0:
        return 0.0
    thinner = max(1, min(line_box[2] - line_box[0], box[2] - box[0]))
    if h < MIN_SHARE * thinner:
        return 0.0
    area = max(1, (line_box[2] - line_box[0]) * (line_box[3] - line_box[1]))
    return round(h * w / area, 3)


def _distance(line_box, box) -> float:
    h, w = _overlap(line_box, box)
    dy, dx = max(0.0, -h), max(0.0, -w)
    line_mid, box_mid = (line_box[0] + line_box[2]) / 2, (box[0] + box[2]) / 2
    if line_mid > box_mid:  # the line is below the ink: measured from the top of the ink, so a thick stroke gets no closer
        dy = max(0.0, line_box[0] - box[0]) * BELOW_COST + 1
    dx *= SIDE_COST
    return (dx * dx + dy * dy) ** 0.5


def pick_line(lines: list[ReadLine], help_box=None) -> ReadLine | None:
    """The line the student means. Printed lines count: a lettered part of a worksheet problem can be the target.

    1. A line `help_box` lies on: the last handwritten one, else the printed one it covers most of
       (the upper one when it covers several alike).
    2. Else the line nearest to `help_box` (a line just above it wins over one just below).
    3. Else the latest handwritten line, else the first printed line in view.
    """
    if not lines:
        return None
    if help_box:
        hits = [(l, _on(l.box, help_box)) for l in lines]
        hits = [(l, a) for l, a in hits if a > 0]
        hand = [l for l, _ in hits if l.source != "printed"]
        if hand:
            return hand[-1]
        if hits:
            return max(hits, key=lambda h: h[1])[0]  # max keeps the first of equals: the upper line
        near = min(lines, key=lambda l: _distance(l.box, help_box))
        if _distance(near.box, help_box) <= NEAR:
            return near
    hand = [l for l in lines if l.source != "printed"]
    return hand[-1] if hand else lines[0]
