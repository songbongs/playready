# Turn Flow Output Format

This spec defines how playready generates game-specific player turn flow data.

## Goal

The turn flow in Document A and Document B must not be generic.
It must be derived from the current game's rules and must reflect:

- what happens at the start of a turn
- what the player can choose
- where choices branch
- what is resolved after the choice
- when the turn or round can end

## Generation Strategy

1. The AI does not generate final HTML flowchart markup.
2. The AI returns compact structured flow data in JSON.
3. The server renders that JSON into a vertical flowchart with boxes, arrows, branches, and merge points.

This keeps layout quality stable while still making the content game-specific.

## JSON Shape

```json
{
  "detailed": {
    "lead": "한 턴이 어떻게 흘러가는지 짧게 소개하는 문장",
    "steps": [
      {
        "kind": "start",
        "title": "내 차례 시작",
        "detail": "턴 시작 시 확인할 조건",
        "tone": "neutral"
      },
      {
        "kind": "decision",
        "title": "무엇을 할 수 있나?",
        "detail": "선택이 갈리는 기준",
        "tone": "primary"
      },
      {
        "kind": "branch",
        "title": "가능한 핵심 선택지",
        "detail": "대표 행동을 고르는 구간",
        "tone": "secondary",
        "options": [
          {
            "title": "행동 A",
            "detail": "이 행동의 핵심 처리",
            "tone": "secondary"
          },
          {
            "title": "행동 B",
            "detail": "이 행동의 핵심 처리",
            "tone": "secondary"
          }
        ]
      },
      {
        "kind": "merge",
        "title": "후속 처리",
        "detail": "선택 후 공통으로 처리되는 단계",
        "tone": "warning"
      },
      {
        "kind": "end",
        "title": "턴 종료",
        "detail": "다음 플레이어 또는 라운드 종료 판단",
        "tone": "neutral"
      }
    ]
  },
  "simplified": {
    "lead": "설명용으로 더 짧게 정리한 한 턴 요약",
    "steps": [
      {
        "kind": "start",
        "title": "차례 시작",
        "detail": "시작 상태 확인",
        "tone": "neutral"
      },
      {
        "kind": "decision",
        "title": "행동 선택",
        "detail": "대표 행동 중 하나 선택",
        "tone": "primary"
      },
      {
        "kind": "branch",
        "title": "핵심 선택지",
        "detail": "설명에 꼭 필요한 선택지만 표시",
        "tone": "secondary",
        "options": [
          {
            "title": "행동 A",
            "detail": "짧은 설명",
            "tone": "secondary"
          },
          {
            "title": "행동 B",
            "detail": "짧은 설명",
            "tone": "secondary"
          }
        ]
      },
      {
        "kind": "end",
        "title": "턴 마무리",
        "detail": "효과 처리 후 다음 차례",
        "tone": "neutral"
      }
    ]
  }
}
```

## Field Rules

- `lead`
  - 1 sentence only
  - explain the turn flow briefly

- `kind`
  - allowed values: `start`, `decision`, `branch`, `merge`, `end`

- `title`
  - short
  - preferably under 16 Korean characters

- `detail`
  - 1 short sentence
  - explain only one meaning

- `tone`
  - allowed values: `neutral`, `primary`, `secondary`, `warning`

- `options`
  - only for `branch`
  - usually 2 to 4 items

## Document A Rules

- use the `detailed` object
- include real game terminology
- include actual branch points from the game's turn
- keep exceptions short, but preserve meaningful choices

## Document B Rules

- use the `simplified` object
- keep only the choices needed for live explanation
- do not overload the flow with rare exceptions
- make it readable in 5 to 10 seconds

## Rendering Rules

- always top-to-bottom
- always vertical arrows between major nodes
- branch options shown side-by-side, then merge back
- no large paragraphs inside nodes
- if flow data is missing or weak, do not fall back to a fake generic chart without warning

