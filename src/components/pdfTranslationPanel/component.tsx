import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../store/useAppStore";
import { isAiAvailable } from "../../utils/aiReading/aiGateway";
import { onReaderPositionChange } from "../../utils/aiReading/readerAdapter";
import { throttle } from "../../utils/common";
import {
  getCachedTranslations,
  translateParagraphs,
} from "../../utils/reader/fullTranslation";
import { getVisiblePdfPages, PdfPageText } from "../../utils/reader/pdfPageText";
import {
  onTranslationTargetChange,
  PDF_TRANS_CHAPTER,
  setPdfTranslation,
} from "../../utils/reader/pdfOverlayTranslation";
import "./pdfTranslationPanel.css";

interface PanelPage extends PdfPageText {
  chapter: string;
}


/** PDF 等固定版式书籍的段落对照翻译：右侧面板按段落上下行展示原文与译文 */
const PdfTranslationPanel = () => {
  const { t } = useTranslation();
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const isOpen = useAppStore((s) => s.reader.isPdfTranslationOpen);
  const handlePanel = useAppStore((s) => s.handlePdfTranslationPanel);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);

  const [pages, setPages] = useState<PanelPage[]>([]);
  const [dict, setDict] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [showSource, setShowSource] = useState(
    ConfigService.getReaderConfig("pdfTransShowSource") !== "no"
  );
  const failedRef = useRef(new Set<string>());
  const tokenRef = useRef(0);
  const pageSignatureRef = useRef("");

  const refresh = useCallback(async () => {
    if (!currentBook || !htmlBook?.rendition) return;
    const visible = getVisiblePdfPages(currentBook).map((p) => ({
      ...p,
      chapter: PDF_TRANS_CHAPTER,
    }));
    // 页内容未变化时不重复请求
    const signature = visible.map((p) => p.index + ":" + p.paragraphs.join("").length).join("|");
    if (signature === pageSignatureRef.current) return;
    pageSignatureRef.current = signature;
    setPages(visible);
    const cached: Record<string, Record<string, string>> = {};
    visible.forEach((p) => (cached[p.chapter] = getCachedTranslations(currentBook.key, p.chapter)));
    setDict(cached);
    if (!visible.length) return;
    if (!isAiAvailable("translate")) return;
    const token = ++tokenRef.current;
    setLoading(true);
    try {
      for (const page of visible) {
        const result = await translateParagraphs(
          currentBook,
          page.chapter,
          page.paragraphs,
          failedRef.current
        );
        if (token !== tokenRef.current) return;
        setDict((prev) => ({ ...prev, [page.chapter]: { ...result } }));
      }
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, [currentBook, htmlBook]);

  useEffect(() => {
    if (!isOpen || !htmlBook?.rendition) return;
    if (!isAiAvailable("translate")) {
      toast(t("No AI service configured. Please add one in Settings > AI service"));
      handlePanel(false);
      handleSetting(true);
      handleSettingMode("ai");
      return;
    }
    pageSignatureRef.current = "";
    // 翻页后文字层异步渲染，稍等再读取
    const run = throttle(() => window.setTimeout(refresh, 400), 600);
    run();
    const off = onReaderPositionChange(htmlBook.rendition, run);
    const offTarget = onTranslationTargetChange(() => {
      failedRef.current.clear();
      pageSignatureRef.current = "";
      refresh();
    });
    const scroller = document.getElementById("page-area");
    scroller?.addEventListener("scroll", run);
    return () => {
      off();
      offTarget();
      scroller?.removeEventListener("scroll", run);
      tokenRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, htmlBook, refresh]);

  if (!isOpen) return null;

  const retry = () => {
    failedRef.current.clear();
    pageSignatureRef.current = "";
    refresh();
  };

  const hasParagraphs = pages.some((p) => p.paragraphs.length);
  return (
    <div className="pdf-trans-panel">
      <div className="pdf-trans-header">
        <span className="pdf-trans-title">{t("Translation")}</span>
        <span
          className="icon-close pdf-trans-close"
          aria-label={t("Close")}
          onClick={() => setPdfTranslation(currentBook, { enabled: false })}
        ></span>
      </div>
      <div className="pdf-trans-toolbar">
        <label className="pdf-trans-toggle">
          <input
            type="checkbox"
            checked={showSource}
            onChange={(event) => {
              setShowSource(event.target.checked);
              ConfigService.setReaderConfig(
                "pdfTransShowSource",
                event.target.checked ? "yes" : "no"
              );
            }}
          />
          {t("Show original text")}
        </label>
      </div>
      <div className="pdf-trans-body">
        {!hasParagraphs && (
          <div className="pdf-trans-empty">
            {t("No selectable text on this page (it may be a scanned PDF)")}
          </div>
        )}
        {pages.map((page) =>
          page.paragraphs.map((text, i) => {
            const translated = dict[page.chapter]?.[text];
            const failed = !translated && failedRef.current.has(text);
            return (
              <div className="pdf-trans-item" key={`${page.index}-${i}`}>
                {showSource && <div className="pdf-trans-source">{text}</div>}
                <div
                  className={
                    "pdf-trans-target" +
                    (translated ? "" : failed ? " pdf-trans-failed" : " pdf-trans-loading")
                  }
                >
                  {translated || (failed ? "×" : "···")}
                </div>
              </div>
            );
          })
        )}
        {!loading && pages.some((p) => p.paragraphs.some((x) => failedRef.current.has(x))) && (
          <span className="pdf-trans-retry" onClick={retry}>
            {t("Retry")}
          </span>
        )}
      </div>
    </div>
  );
};

export default PdfTranslationPanel;
