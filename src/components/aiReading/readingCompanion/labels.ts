import type { AnnotationKind, CompanionAction } from "../../../utils/aiReading/readingMarks";

/** 文案 key（en.json / zh-CN.json） */
export const KIND_LABEL_KEYS: Record<AnnotationKind, string> = {
  term: "Term",
  idea: "Core idea",
};

export const ACTION_LABEL_KEYS: Record<CompanionAction, string> = {
  assist: "Reading aid",
  relate: "Knowledge links",
  further: "Further reading",
};
