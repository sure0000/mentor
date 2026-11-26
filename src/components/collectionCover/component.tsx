import React, { useEffect, useState } from "react";
import "./collectionCover.css";
import DatabaseService from "../../utils/storage/databaseService";
import CoverUtil from "../../utils/file/coverUtil";
import EmptyCover from "../emptyCover";

export interface CollectionCoverProps {
  bookKeys: string[];
  refreshBookKey: string;
  width: number;
  height: number;
}

export interface CollectionCoverItem {
  cover: string;
  title: string;
  format: string;
}

const MAX_COVER_COUNT = 4;
const CELL_GAP = 4;

const CollectionCover: React.FC<CollectionCoverProps> = (props) => {
  const { bookKeys, refreshBookKey, width, height } = props;
  const latestKeys = bookKeys.slice(-MAX_COVER_COUNT).reverse();
  const latestKeyStr = latestKeys.join(",");
  const [items, setItems] = useState<{ [key: string]: CollectionCoverItem }>(
    {}
  );

  useEffect(() => {
    let cancelled = false;
    async function loadCovers() {
      let result: { [key: string]: CollectionCoverItem } = {};
      for (let i = 0; i < latestKeys.length; i++) {
        let key = latestKeys[i];
        try {
          let book = await DatabaseService.getRecord(key, "books");
          if (!book) {
            result[key] = { cover: "", title: "", format: "" };
            continue;
          }
          let title = book.name || "";
          let format = book.format || "";
          let isCoverExist = await CoverUtil.isCoverExist(book);
          if (!isCoverExist) {
            result[key] = { cover: "", title, format };
            continue;
          }
          let cover = await CoverUtil.getCover(book);
          if (
            cover &&
            !cover.startsWith("data:") &&
            !cover.startsWith("blob:") &&
            !cover.startsWith("http")
          ) {
            cover = cover + "?t=" + Date.now();
          }
          result[key] = { cover: cover || "", title, format };
        } catch {
          result[key] = { cover: "", title: "", format: "" };
        }
      }
      if (!cancelled) {
        setItems(result);
      }
    }
    loadCovers();
    return () => {
      cancelled = true;
    };
  }, [latestKeyStr, refreshBookKey]);

  return <CollectionCoverGrid width={width} height={height}
    cells={latestKeys.map((key) => ({ key, item: items[key] }))} />;
};

type CoverCell = { key: string; item?: CollectionCoverItem };

export const CollectionCoverGrid = ({ cells, width, height }: {
  cells: CoverCell[]; width: number; height: number;
}) => {
  const visible = cells.slice(0, MAX_COVER_COUNT);
  const count = visible.length;
  const cellWidth = (width - CELL_GAP) / 2;
  const cellHeight = (height - CELL_GAP) / 2;
  const emptyCoverScale = Math.max(cellWidth / 105, cellHeight / 137);

  return (
    <div
      className="collection-cover"
      style={{ width: `${width}px`, height: `${height}px`, gap: CELL_GAP }}
    >
      {count === 0 ? (
        <div className="collection-cover-placeholder"></div>
      ) : (
        <>
          {visible.map(({ key, item }) => (
            <Thumbnail key={key} item={item} scale={emptyCoverScale} />
          ))}
          {/* 不足 4 本时补齐空格子，避免 2x2 网格出现空洞 */}
          {Array.from({ length: MAX_COVER_COUNT - count }).map((_, index) => (
            <div
              className="collection-cover-cell collection-cover-cell-blank"
              key={`blank-${index}`}
            ></div>
          ))}
        </>
      )}
    </div>
  );
};

const Thumbnail = ({ item, scale }: { item?: CollectionCoverItem; scale: number }) => {
  const [failedUrl, setFailedUrl] = useState("");
  return (
    <div className="collection-cover-cell">
      {item?.cover && item.cover !== failedUrl ? (
        <img src={item.cover} alt="" draggable={false} referrerPolicy="no-referrer"
          onError={() => setFailedUrl(item.cover)} />
      ) : (
        <div className="collection-cover-cell-empty">
          {item && (
            <div className="collection-cover-cell-empty-inner"
              style={{ width: 105 * scale, height: 137 * scale }}>
              <EmptyCover format={item.format} title={item.title} scale={scale} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CollectionCover;
