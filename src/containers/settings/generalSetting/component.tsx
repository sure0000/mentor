import { Trans } from "react-i18next";
import { changeLanguage as changeI18nLanguage } from "../../../i18n";
import { langList } from "../../../constants/settingList";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";

const GeneralSetting = () => {
  const changeLanguage = (lng: string) => {
    changeI18nLanguage(lng);
    ConfigService.setReaderConfig("lang", lng);
  };
  return (
    <div className="setting-dialog-new-title">
      <Trans>Language</Trans>
      <select
        name=""
        className="lang-setting-dropdown"
        value={ConfigService.getReaderConfig("lang") || "en"}
        onChange={(event) => {
          changeLanguage(event.target.value);
        }}
      >
        {langList.map((item) => (
          <option
            value={item.value}
            key={item.value}
            className="lang-setting-option"
          >
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default GeneralSetting;
