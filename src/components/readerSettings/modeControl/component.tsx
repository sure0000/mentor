import "./modeControl.css";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { isPaginatedBook } from "../../../utils/common";
import { Trans } from "react-i18next";
import { useAppStore } from "../../../store/useAppStore";

const modeOptions = [
  { mode: "single", title: "Single page" },
  { mode: "double", title: "Double page" },
  { mode: "scroll", title: "Scroll" },
];

const ModeControl = () => {
  const renderBookFunc = useAppStore((s) => s.book.renderBookFunc);
  const readerMode = useAppStore((s) => s.reader.readerMode);
  const currentBook = useAppStore((s) => s.book.currentBook);
  const handleReaderMode = useAppStore((s) => s.handleReaderMode);
  const handleChangeMode = (mode: string) => {
    if (mode === readerMode) return;
    if (isPaginatedBook(currentBook)) {
      ConfigService.setReaderConfig("pdfReaderMode", mode);
    } else {
      ConfigService.setReaderConfig("readerMode", mode);
    }

    handleReaderMode(mode);
    renderBookFunc();
  };
  return (
    <div className="panel-segmented">
      {modeOptions.map((item) => (
        <div
          key={item.mode}
          className={
            readerMode === item.mode
              ? "panel-segmented-item active"
              : "panel-segmented-item"
          }
          onClick={() => {
            handleChangeMode(item.mode);
          }}
        >
          <Trans>{item.title}</Trans>
        </div>
      ))}
    </div>
  );
};
export default ModeControl;
