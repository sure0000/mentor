import React from "react";
import "./emptyCover.css";
import { getCoverTheme } from "../../utils/common";

const emptyCover = (props) => {
  return (
    <div
      className="empty-cover"
      style={{ transform: `scale(${props.scale})` }}
    >
      <div
        className="cover-banner"
        style={{
          backgroundColor: getCoverTheme(props.format),
        }}
      >
        {props.format || "BOOK"}
      </div>
      <div className="cover-title" style={{marginLeft:"8px"}}>{props.title}</div>
      <div className="cover-footer">Mentor</div>
    </div>
  );
};

export default emptyCover;
