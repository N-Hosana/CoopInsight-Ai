"""Member engagement endpoint."""

from fastapi import APIRouter, Query

from ..analytics import engagement as engine
from ..schemas import EngagementResponse

router = APIRouter()


@router.get("/member-engagement", response_model=EngagementResponse)
def member_engagement(cooperativeId: str | None = Query(default=None)) -> EngagementResponse:
    if not cooperativeId:
        return EngagementResponse(
            cooperativeId=None,
            engagement=[],
            model_name=engine.MODEL_NAME,
            note="A cooperativeId is required to score member engagement.",
        )
    return EngagementResponse(**engine.score(cooperativeId))
