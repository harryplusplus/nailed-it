#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export HINDSIGHT_API_DATABASE_URL=postgresql://harry@localhost:5432/hindsight
export HINDSIGHT_API_LLM_BASE_URL=http://localhost:4000/v1
export HINDSIGHT_API_LLM_API_KEY=dummy
export HINDSIGHT_API_LLM_MODEL=mimo-v2.5-pro-precision
export HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-m3
export HINDSIGHT_API_TEXT_SEARCH_EXTENSION=vchord
export HINDSIGHT_API_RERANKER_LOCAL_MODEL=bongsoo/albert-small-kor-cross-encoder-v1
export HINDSIGHT_API_RECALL_MAX_QUERY_TOKENS=1500
export HINDSIGHT_API_RETAIN_MISSION="텍스트에서 중요한 사실만 선택적으로 추출한다. 장기 기억에 가치 있는 사실만 남기고, 인사·잡담·필러·프로세스 잡담·반복 정보는 제외한다. 개인정보·선호·중대한 이벤트·계획·전문성·중요한 맥락·감각·정서적 세부 사항·관찰을 포함한다. 모든 출력은 입력 텍스트와 동일한 언어(한국어)로 한다."
export HINDSIGHT_API_OBSERVATIONS_MISSION="모든 세부 사항을 추적한다: 이름, 숫자, 날짜, 장소, 관계. 추상화보다 구체적인 사실을 선호하며, 절대 일반화하지 않는다. 모든 출력은 원본 텍스트의 언어(한국어)를 그대로 보존한다."

exec uvx --from=hindsight-api-slim==0.6.2 \
    --with=sentence_transformers==5.5.1 \
    hindsight-api
