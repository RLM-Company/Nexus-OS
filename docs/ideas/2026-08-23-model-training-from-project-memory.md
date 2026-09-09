# Обучение моделей на project memory

**Исходная дата идеи:** 2026-08-23  
**Текущий статус:** `DEFERRED / PRIVACY REVIEW REQUIRED`

## Исходная идея

Использовать накопленную project memory не только как retrieval context, но и как материал для улучшения/обучения моделей под конкретный проект или владельца.

## Почему не является текущим requirement

Это существенно отличается от обычного context retrieval и затрагивает:

- privacy/consent;
- data retention;
- право на удаление;
- confidential/project-separated data;
- provenance;
- model/provider data handling;
- возможность необратимого попадания данных в training artifacts.

До выбора production architecture и отдельной privacy/data-governance спецификации идея не должна влиять на runtime.

## Более безопасная последовательность исследования

Перед fine-tuning/training сначала оценить менее необратимые подходы:

- project retrieval/RAG;
- structured memory;
- reusable project instructions/patterns;
- local adapters или owner-controlled fine-tuning только при явном consent;
- synthetic/evaluated training sets без secrets и unrelated private data.

Это направления исследования, а не утверждённая реализация.

## Hard boundary

Нельзя автоматически отправлять project memory на обучение внешнему provider только потому, что integration/model access уже разрешены. Training/data reuse требует отдельного, явно определённого data-use contract и owner consent.
