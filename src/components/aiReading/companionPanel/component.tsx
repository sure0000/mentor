import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store/useAppStore";
import ReadingCompanion from "../readingCompanion";
import "./companionPanel.css";

/** AI 伴读：阅读器右侧独立抽屉，与 AI 问书弹窗互不影响 */
const CompanionPanel = () => {
  const { t } = useTranslation();
  const isCompanionOpen = useAppStore((s) => s.reader.isCompanionOpen);
  const handleCompanionPanel = useAppStore((s) => s.handleCompanionPanel);

  if (!isCompanionOpen) return null;
  return (
    <div className="companion-panel">
      <div className="companion-panel-header">
        <span className="companion-panel-title">{t("Reading Companion")}</span>
        <span
          className="icon-close companion-panel-close"
          aria-label={t("Close")}
          onClick={() => handleCompanionPanel(false)}
        ></span>
      </div>
      <div className="companion-panel-body">
        <ReadingCompanion />
      </div>
    </div>
  );
};

export default CompanionPanel;
