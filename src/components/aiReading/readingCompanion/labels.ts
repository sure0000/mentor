import type { CompanionAction, ReadingLevel } from "../../../utils/aiReading/readingMarks";

/** 文案 key（en.json / zh-CN.json） */
export const LEVEL_LABEL_KEYS: Record<ReadingLevel, string> = {
  skim: "Skim",
  light: "Light reading",
  deep: "Deep reading",
};

export const ACTION_LABEL_KEYS: Record<CompanionAction, string> = {
  assist: "Reading aid",
  relate: "Knowledge links",
  further: "Further reading",
};
