import React from "react";
import "./bookCoverFrame.css";

export interface BookCoverFrameProps {
  style?: React.CSSProperties;
  children: React.ReactNode;
}

const BookCoverFrame: React.FC<BookCoverFrameProps> = ({ style, children }) => {
  return (
    <div className="book-cover-frame" style={style}>
      {children}
    </div>
  );
};

export default BookCoverFrame;
