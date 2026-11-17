import { useLatest } from "../../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import "./opdsDialog.css";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../../store/useAppStore";
import {
  ACQUISITION_RELS,
  DOWNLOAD_TYPES,
  downloadOPDSFile,
  fetchOPDSFeed,
  fetchWithCatalogAuth,
} from "../../../utils/request/opds";
import type {
  OPDSCatalog,
  OPDSEntry,
  OPDSFeed,
  OPDSLink,
} from "../../../utils/request/opds";
import { supportedFormats } from "../../../utils/common";

export interface OPDSDialogState {
  view: "catalog" | "feed" | "detail";
  userCatalogs: OPDSCatalog[];
  currentFeed: OPDSFeed | null;
  feedStack: { url: string; title: string }[];
  currentCatalogAuth: {
    username: string;
    password: string;
  } | null;
  selectedBook: OPDSEntry | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
  searchQuery: string;
  isAddingCatalog: boolean;
  newCatalogUrl: string;
  newCatalogTitle: string;
  newCatalogUsername: string;
  newCatalogPassword: string;
  isTesting: boolean;
}


interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className: string;
  catalogAuth?: Pick<OPDSCatalog, "username" | "password"> | null;
  onError?: () => void;
}

interface AuthenticatedImageState {
  blobUrl: string;
  isFailed: boolean;
}

const AuthenticatedImage = ({
  src,
  alt,
  className,
  catalogAuth,
  onError,
}: AuthenticatedImageProps) => {
  const [state, setState] = useState<AuthenticatedImageState>({
    blobUrl: "",
    isFailed: false,
  });
  const currentBlobUrl = useRef("");

  const revokeBlobUrl = () => {
    if (currentBlobUrl.current) {
      URL.revokeObjectURL(currentBlobUrl.current);
      currentBlobUrl.current = "";
    }
  };

  const loadImage = async () => {
    if (!src) {
      revokeBlobUrl();
      setState({ blobUrl: "", isFailed: true });
      return;
    }

    try {
      const response = await fetchWithCatalogAuth(src, {}, catalogAuth);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      revokeBlobUrl();
      const blobUrl = URL.createObjectURL(blob);
      currentBlobUrl.current = blobUrl;
      setState({ blobUrl, isFailed: false });
    } catch {
      revokeBlobUrl();
      setState({ blobUrl: "", isFailed: true });
      onError?.();
    }
  };

  const loadImageRef = useLatest(loadImage);

  useEffect(() => {
    loadImageRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, catalogAuth?.username, catalogAuth?.password]);

  useEffect(() => {
    return () => {
      if (currentBlobUrl.current) {
        URL.revokeObjectURL(currentBlobUrl.current);
        currentBlobUrl.current = "";
      }
    };
  }, []);

  const { blobUrl, isFailed } = state;
  if (!blobUrl || isFailed) return null;
  return <img src={blobUrl} alt={alt} className={className} />;
};

const OPDSDialog = () => {
  const importBookFunc = useAppStore((s) => s.book.importBookFunc);
  const handleOPDSDialog = useAppStore((s) => s.handleOPDSDialog);
  const { t } = useTranslation();
  const loadUserCatalogs = (): OPDSCatalog[] => {
    try {
      const catalogMap = ConfigService.getAllObjectConfig("opdsCatalogs") || {};
      const catalogList =
        ConfigService.getAllListConfig("opdsCatalogList") || [];
      return catalogList
        .map((id: string) => catalogMap[id])
        .filter(Boolean) as OPDSCatalog[];
    } catch {
      return [];
    }
  };

  const [state, setState] = useState<OPDSDialogState>({
    view: "catalog",
    userCatalogs: loadUserCatalogs(),
    currentFeed: null,
    feedStack: [],
    currentCatalogAuth: null,
    selectedBook: null,
    isLoading: false,
    isLoadingMore: false,
    error: "",
    searchQuery: "",
    isAddingCatalog: false,
    newCatalogUrl: "",
    newCatalogTitle: "",
    newCatalogUsername: "",
    newCatalogPassword: "",
    isTesting: false,
  });

  const stateRef = useLatest(state);

  const mergeState = (patch: Partial<OPDSDialogState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  const handleClose = () => handleOPDSDialog(false);

  const openCatalog = async (catalog: OPDSCatalog) => {
    mergeState({
      view: "feed",
      isLoading: true,
      isLoadingMore: false,
      error: "",
      feedStack: [{ url: catalog.url, title: catalog.title }],
      currentCatalogAuth: {
        username: catalog.username || "",
        password: catalog.password || "",
      },
      currentFeed: null,
      searchQuery: "",
    });
    try {
      const feed = await fetchOPDSFeed(catalog.url, catalog);
      mergeState({ currentFeed: feed, isLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mergeState({ isLoading: false, error: msg });
      toast.error(t("Failed to load catalog") + ": " + msg);
    }
  };

  const navigateToEntry = async (entry: OPDSEntry) => {
    const { currentCatalogAuth } = stateRef.current;
    const navLink = entry.links.find(
      (l) =>
        l.type?.includes("application/atom+xml") ||
        l.type?.includes("text/html") ||
        l.rel === "subsection" ||
        l.rel === "related"
    );
    if (!navLink) return;
    setState((prev) => ({
      ...prev,
      isLoading: true,
      isLoadingMore: false,
      error: "",
      feedStack: [...prev.feedStack, { url: navLink.href, title: entry.title }],
      searchQuery: "",
    }));
    try {
      const feed = await fetchOPDSFeed(navLink.href, currentCatalogAuth);
      mergeState({ currentFeed: feed, isLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: msg,
        feedStack: prev.feedStack.slice(0, -1),
      }));
      toast.error(t("Failed to load catalog") + ": " + msg);
    }
  };

  const loadMore = async () => {
    const { currentFeed, currentCatalogAuth, isLoading, isLoadingMore } =
      stateRef.current;
    if (isLoading || isLoadingMore || !currentFeed) return;
    const nextLink = currentFeed.links.find((l) => l.rel === "next");
    if (!nextLink) return;
    const originalFeed = currentFeed;
    mergeState({ isLoadingMore: true });
    try {
      const nextFeed = await fetchOPDSFeed(nextLink.href, currentCatalogAuth);
      setState((prev) => {
        if (prev.currentFeed !== originalFeed) {
          return {
            ...prev,
            isLoadingMore: false,
            currentFeed: prev.currentFeed,
          };
        }
        return {
          ...prev,
          isLoadingMore: false,
          currentFeed: {
            ...prev.currentFeed,
            entries: prev.currentFeed.entries.concat(nextFeed.entries),
            links: nextFeed.links,
          },
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mergeState({ isLoadingMore: false });
      if (stateRef.current.currentFeed === originalFeed) {
        toast.error(t("Failed to load more") + ": " + msg);
      }
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (stateRef.current.view !== "feed") return;
    const { isLoading, isLoadingMore, currentFeed } = stateRef.current;
    if (isLoading || isLoadingMore || !currentFeed) return;
    if (!currentFeed.links.some((l) => l.rel === "next")) return;
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 150) {
      loadMore();
    }
  };

  const handleBack = () => {
    const { view, feedStack, currentCatalogAuth } = stateRef.current;
    if (view === "detail") {
      mergeState({ view: "feed", selectedBook: null });
      return;
    }
    if (view === "feed") {
      if (feedStack.length <= 1) {
        mergeState({
          view: "catalog",
          currentFeed: null,
          feedStack: [],
          isLoadingMore: false,
        });
        return;
      }
      const newStack = feedStack.slice(0, -1);
      const parentUrl = newStack[newStack.length - 1].url;
      mergeState({
        isLoading: true,
        isLoadingMore: false,
        error: "",
        feedStack: newStack,
        searchQuery: "",
      });
      fetchOPDSFeed(parentUrl, currentCatalogAuth)
        .then((feed) => mergeState({ currentFeed: feed, isLoading: false }))
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          mergeState({ isLoading: false, error: msg });
        });
    }
  };

  const handleSearch = async () => {
    const { currentFeed, searchQuery, currentCatalogAuth } = stateRef.current;
    if (!currentFeed?.searchTemplate || !searchQuery.trim()) return;
    let searchUrl = currentFeed.searchTemplate;
    if (!searchUrl.includes("searchTerms")) {
      try {
        const resp = await fetchWithCatalogAuth(
          searchUrl,
          {},
          currentCatalogAuth
        );
        const text = await resp.text();
        const parser = new DOMParser();
        const osDoc = parser.parseFromString(text, "application/xml");
        const urlEl = osDoc.querySelector(
          "Url[type*='atom'], Url[type*='opds']"
        );
        if (urlEl) searchUrl = urlEl.getAttribute("template") || searchUrl;
      } catch {
        // fallback to original
      }
    }
    let finalUrl = searchUrl
      .replace("{searchTerms}", encodeURIComponent(searchQuery.trim()))
      .replace("%7BsearchTerms%7D", encodeURIComponent(searchQuery.trim()));
    if (!finalUrl.startsWith("http")) {
      const baseUrl =
        stateRef.current.feedStack[0]?.url || currentFeed?.url || "";
      if (baseUrl) {
        finalUrl = new URL(finalUrl, baseUrl).href;
      }
    }
    mergeState({ isLoading: true, isLoadingMore: false, error: "" });
    try {
      const feed = await fetchOPDSFeed(finalUrl, currentCatalogAuth);
      setState((prev) => ({
        ...prev,
        currentFeed: {
          ...feed,
          searchTemplate: prev.currentFeed?.searchTemplate || "",
        },
        feedStack: [
          ...prev.feedStack,
          { url: finalUrl, title: t("Search") + ": " + searchQuery },
        ],
        isLoading: false,
        searchQuery: "",
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) {
        setState((prev) => ({
          ...prev,
          currentFeed: {
            title: t("Search") + ": " + searchQuery,
            url: finalUrl,
            entries: [],
            links: [],
            searchTemplate: prev.currentFeed?.searchTemplate || "",
          },
          feedStack: [
            ...prev.feedStack,
            {
              url: finalUrl,
              title: t("Search") + ": " + searchQuery,
            },
          ],
          isLoading: false,
          searchQuery: "",
        }));
      } else {
        mergeState({ isLoading: false, error: msg });
        toast.error(t("Search failed") + ": " + msg);
      }
    }
  };

  const handleDownloadBook = async (entry: OPDSEntry, link: OPDSLink) => {
    const { currentCatalogAuth } = stateRef.current;
    const ext = DOWNLOAD_TYPES[link.type] || link.href.split(".").pop() || "";
    if (!supportedFormats.includes("." + ext)) {
      toast.error(t("Unsupported file format") + ": " + link.type);
      return;
    }
    toast.loading(t("Downloading") + ": " + entry.title, {
      id: "opds-download",
      position: "bottom-center",
    });
    try {
      const file = await downloadOPDSFile(
        entry.title,
        link,
        currentCatalogAuth
      );
      toast.dismiss("opds-download");
      await importBookFunc(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("Import failed") + ": " + msg, {
        id: "opds-download",
      });
    }
  };

  const handleAddCatalog = () => {
    const {
      newCatalogUrl,
      newCatalogTitle,
      newCatalogUsername,
      newCatalogPassword,
    } = stateRef.current;
    if (!newCatalogUrl.trim()) {
      toast.error(t("Please enter a valid URL"));
      return;
    }
    const id = Date.now() + "";
    const newCatalog: OPDSCatalog = {
      id,
      title: newCatalogTitle.trim() || newCatalogUrl.trim(),
      url: newCatalogUrl.trim(),
      username: newCatalogUsername.trim(),
      password: newCatalogPassword,
    };
    ConfigService.setObjectConfig(id, newCatalog, "opdsCatalogs");
    ConfigService.setListConfig(id, "opdsCatalogList");
    mergeState({
      userCatalogs: loadUserCatalogs(),
      isAddingCatalog: false,
      newCatalogUrl: "",
      newCatalogTitle: "",
      newCatalogUsername: "",
      newCatalogPassword: "",
      isTesting: false,
    });
    toast.success(t("Added successfully"));
  };

  const handleTestCatalog = async () => {
    const { newCatalogUrl, newCatalogUsername, newCatalogPassword } =
      stateRef.current;
    if (!newCatalogUrl.trim()) {
      toast.error(t("Please enter a valid URL"));
      return;
    }
    mergeState({ isTesting: true });
    try {
      const auth =
        newCatalogUsername || newCatalogPassword
          ? { username: newCatalogUsername, password: newCatalogPassword }
          : null;
      await fetchOPDSFeed(newCatalogUrl.trim(), auth);
      toast.success(t("Connection successful"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("Connection failed") + ": " + msg);
    } finally {
      mergeState({ isTesting: false });
    }
  };

  const handleRemoveCatalog = (id: string) => {
    ConfigService.deleteObjectConfig(id, "opdsCatalogs");
    ConfigService.deleteListConfig(id, "opdsCatalogList");
    mergeState({ userCatalogs: loadUserCatalogs() });
  };

  const getDownloadLinks = (entry: OPDSEntry): OPDSLink[] => {
    return entry.links.filter(
      (l) =>
        ACQUISITION_RELS.some((rel) => l.rel === rel) &&
        (DOWNLOAD_TYPES[l.type] ||
          supportedFormats.includes(
            "." + l.href.split(".").pop()?.toLowerCase()
          ))
    );
  };

  const renderCatalogView = () => {
    const {
      userCatalogs,
      isAddingCatalog,
      newCatalogUrl,
      newCatalogTitle,
      newCatalogUsername,
      newCatalogPassword,
      isTesting,
    } = state;

    return (
      <>
        {/* Add catalog */}
        {isAddingCatalog ? (
          <div className="opds-add-form">
            <input
              className="token-dialog-username-box"
              type="url"
              placeholder={t("OPDS Catalog URL")}
              value={newCatalogUrl}
              onChange={(e) => mergeState({ newCatalogUrl: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAddCatalog()}
              autoFocus
            />
            <input
              className="token-dialog-username-box"
              type="text"
              placeholder={
                t("Catalog Name") +
                " (" +
                t("Optional") +
                ")"
              }
              value={newCatalogTitle}
              onChange={(e) =>
                mergeState({ newCatalogTitle: e.target.value })
              }
              onKeyDown={(e) => e.key === "Enter" && handleAddCatalog()}
            />
            <input
              className="token-dialog-username-box"
              type="text"
              placeholder={
                t("Username") + " (" + t("Optional") + ")"
              }
              value={newCatalogUsername}
              onChange={(e) =>
                mergeState({ newCatalogUsername: e.target.value })
              }
              onKeyDown={(e) => e.key === "Enter" && handleAddCatalog()}
            />
            <input
              className="token-dialog-username-box"
              type="password"
              placeholder={
                t("Password") + " (" + t("Optional") + ")"
              }
              value={newCatalogPassword}
              onChange={(e) =>
                mergeState({ newCatalogPassword: e.target.value })
              }
              onKeyDown={(e) => e.key === "Enter" && handleAddCatalog()}
            />
            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "space-between",
                marginTop: "10px",
                paddingRight: "0px",
              }}
            >
              <span
                className="voice-add-confirm"
                style={{
                  position: "static",
                  fontSize: "14px",
                  marginRight: "10px",
                  opacity: isTesting ? 0.6 : 1,
                  pointerEvents: isTesting ? "none" : "auto",
                }}
                onClick={handleTestCatalog}
              >
                {isTesting ? <Trans>Testing...</Trans> : <Trans>Test</Trans>}
              </span>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  justifyContent: "flex-end",
                }}
              >
                <span
                  className="voice-add-cancel"
                  onClick={() =>
                    mergeState({
                      isAddingCatalog: false,
                      newCatalogUrl: "",
                      newCatalogTitle: "",
                      newCatalogUsername: "",
                      newCatalogPassword: "",
                      isTesting: false,
                    })
                  }
                >
                  <Trans>Cancel</Trans>
                </span>

                <span
                  className="voice-add-confirm"
                  style={{ position: "static", fontSize: "14px" }}
                  onClick={handleAddCatalog}
                >
                  <Trans>Add</Trans>
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* User catalogs */}
        {userCatalogs.length > 0 ? (
          <>
            <div className="opds-section-label">
              <Trans>My OPDS Catalogs</Trans>
            </div>
            {userCatalogs.map((catalog) => (
              <div key={catalog.id} className="cloud-drive-item">
                <span
                  className="cloud-drive-label"
                  onClick={() => openCatalog(catalog)}
                >
                  {catalog.title}
                </span>
                <span
                  className="icon-trash import-dialog-folder-button"
                  style={{ fontSize: "13px", marginRight: "8px" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveCatalog(catalog.id);
                  }}
                ></span>
                <span
                  className="icon-dropdown import-dialog-more-file"
                  onClick={() => openCatalog(catalog)}
                ></span>
              </div>
            ))}
          </>
        ) : (
          <div
            style={{
              textAlign: "center",
              opacity: 0.5,
              padding: "30px 0",
              fontSize: "14px",
            }}
          >
            <Trans>No OPDS added yet</Trans>
          </div>
        )}
      </>
    );
  };

  const renderFeedView = () => {
    const {
      currentFeed,
      isLoading,
      isLoadingMore,
      error,
      searchQuery,
      currentCatalogAuth,
    } = state;

    return (
      <>
        {/* Search bar */}
        {currentFeed?.searchTemplate && (
          <div className="opds-search-bar">
            <input
              className="header-search-box"
              type="text"
              placeholder={t("Search in catalog...")}
              value={searchQuery}
              onChange={(e) => mergeState({ searchQuery: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <span
              className="header-search-text"
              style={{ marginRight: "15px", height: "40px", marginTop: "5px" }}
            >
              <span
                className="icon-search header-search-icon"
                onClick={handleSearch}
              ></span>
            </span>
          </div>
        )}

        {isLoading && (
          <div
            className="loading-animation"
            style={{ height: "calc(100% - 50px)" }}
          >
            <div className="loader"></div>
          </div>
        )}

        {error && !isLoading && (
          <div
            className="loading-animation"
            style={{
              height: "calc(100% - 50px)",
              fontSize: "13px",
              padding: "0 20px",
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}

        {!isLoading &&
          !error &&
          currentFeed &&
          currentFeed.entries.length === 0 && (
            <div
              className="loading-animation"
              style={{ height: "calc(100% - 50px)" }}
            >
              <Trans>Empty</Trans>
            </div>
          )}

        {!isLoading &&
          !error &&
          currentFeed &&
          currentFeed.entries.map((entry, index) => (
            <div
              key={entry.id || index}
              className="cloud-drive-item opds-entry-row"
              onClick={() => {
                if (entry.isNavigation) {
                  navigateToEntry(entry);
                } else {
                  mergeState({ view: "detail", selectedBook: entry });
                }
              }}
            >
              {/* Cover thumbnail */}
              {!entry.isNavigation && (
                <div className="opds-thumb">
                  {entry.thumbnailUrl ? (
                    <AuthenticatedImage
                      src={entry.thumbnailUrl}
                      alt=""
                      className="opds-thumb-img"
                      catalogAuth={currentCatalogAuth}
                    />
                  ) : (
                    <span
                      className="icon-book"
                      style={{ fontSize: "20px", opacity: 0.3 }}
                    ></span>
                  )}
                </div>
              )}
              {entry.isNavigation && (
                <span
                  className="icon-folder"
                  style={{ fontSize: "15px", margin: "5px" }}
                ></span>
              )}

              {/* Text content */}
              <div className="opds-entry-info">
                <span
                  className="cloud-drive-label"
                  style={{ width: "auto", marginRight: 0 }}
                >
                  {entry.title}
                </span>
                {!entry.isNavigation && entry.authors.length > 0 && (
                  <span className="opds-entry-author">
                    {entry.authors.join(", ")}
                  </span>
                )}
              </div>

              <span className="icon-dropdown import-dialog-more-file"></span>
            </div>
          ))}

        {!isLoading && !error && isLoadingMore && (
          <div className="opds-load-more">
            <div className="loader-mini"></div>
          </div>
        )}
      </>
    );
  };

  const renderDetailView = () => {
    const { selectedBook, currentCatalogAuth } = state;
    if (!selectedBook) return null;
    const formatUpdated = (iso: string) => {
      if (!iso) return "";
      try {
        return new Date(iso).toLocaleDateString();
      } catch {
        return iso;
      }
    };

    // Metadata cells: [label, value] — only show non-empty ones
    const metaCells: [string, string][] = [
      ["Publisher", selectedBook.publisher],
      ["Language", selectedBook.language],
      [
        "Published",
        selectedBook.pubDate ? formatUpdated(selectedBook.pubDate) : "",
      ],
      [
        "Updated",
        selectedBook.updated ? formatUpdated(selectedBook.updated) : "",
      ],
    ].filter(([, v]) => v) as [string, string][];

    return (
      <div className="detail-dialog-book-info" style={{ height: "100%" }}>
        {/* Cover */}
        <div
          className="detail-cover-container"
          style={{
            width: "100%",
            height: "auto",
            margin: 0,
            padding: "16px 0 8px",
          }}
        >
          {selectedBook.coverUrl ? (
            <AuthenticatedImage
              src={selectedBook.coverUrl}
              alt={selectedBook.title}
              className="detail-cover"
              catalogAuth={currentCatalogAuth}
            />
          ) : (
            <span
              className="icon-book"
              style={{ fontSize: "60px", opacity: 0.15 }}
            ></span>
          )}
        </div>

        {/* Title */}
        <p className="detail-dialog-book-title">{selectedBook.title}</p>

        {/* Author */}
        {selectedBook.authors.length > 0 && (
          <p className="detail-dialog-book-author">
            {selectedBook.authors.join(", ")}
          </p>
        )}

        {/* Categories */}
        {selectedBook.categories.length > 0 && (
          <p
            className="detail-dialog-book-author"
            style={{ opacity: 0.5, fontSize: "12px" }}
          >
            {selectedBook.categories.join(" · ")}
          </p>
        )}

        {/* Metadata row */}
        {metaCells.length > 0 && (
          <div className="detail-sub-info">
            {metaCells.map(([label, value], i) => (
              <React.Fragment key={label}>
                {i > 0 && <p className="detail-dialog-book-divider"></p>}
                <div className="detail-dialog-book-publisher">
                  <p className="detail-sub-title">
                    <Trans>{label}</Trans>
                  </p>
                  <div className="detail-sub-content-container">
                    <p className="detail-sub-content">{value}</p>
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Rights */}
        {selectedBook.rights && (
          <p className="detail-dialog-book-desc" style={{ fontSize: "11px" }}>
            {selectedBook.rights}
          </p>
        )}

        {/* Description */}
        {selectedBook.summary && (
          <>
            <p className="detail-dialog-book-desc">
              <Trans>Description</Trans>:
            </p>
            <div className="detail-dialog-book-detail opds-book-description">
              {Parser(DOMPurify.sanitize(selectedBook.summary))}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderTitle = () => {
    const { view, feedStack } = state;
    if (view === "catalog") return <Trans>From OPDS</Trans>;
    if (view === "detail") return <Trans>Book Detail</Trans>;
    if (feedStack.length > 0) return feedStack[feedStack.length - 1].title;
    return <Trans>From OPDS</Trans>;
  };

  const { view, selectedBook } = state;
  const downloadLinks =
    view === "detail" && selectedBook
      ? getDownloadLinks(selectedBook)
      : [];

    return (
      <div
        className="backup-page-container"
        style={{ height: "450px", top: "calc(50% - 225px)" }}
      >
        <div className="backup-dialog-title">{renderTitle()}</div>

        <div className="import-dialog-option" onScroll={handleScroll}>
          {view === "catalog" && renderCatalogView()}
          {view === "feed" && renderFeedView()}
          {view === "detail" && renderDetailView()}
        </div>

        {/* Bottom bar */}
        {view === "detail" && downloadLinks.length > 0 && (
          <div
            className="opds-bottom-bar"
            style={{
              padding: "2px",
            }}
          >
            {downloadLinks.map((link, i) => (
              <div
                key={i}
                className="new-version-open"
                onClick={() => handleDownloadBook(selectedBook!, link)}
                style={{
                  padding: "0px 0px",
                  fontSize: "12px",
                  height: "30px",
                  lineHeight: "30px",
                }}
              >
                <span>
                  <Trans>Download</Trans>
                </span>{" "}
                {(
                  DOWNLOAD_TYPES[link.type] ||
                  link.href.split(".").pop() ||
                  "file"
                ).toUpperCase()}
              </div>
            ))}
          </div>
        )}

        {view !== "catalog" && (
          <div className="import-dialog-back-button" onClick={handleBack}>
            <Trans>Back to parent</Trans>
          </div>
        )}

        <div className="backup-page-close-icon" onClick={handleClose}>
          <span className="icon-close backup-close-icon"></span>
        </div>

        {view === "catalog" && (
          <div
            className="cloud-drive-item"
            onClick={() => mergeState({ isAddingCatalog: true })}
            style={{
              position: "absolute",
              bottom: "0",
              right: "0",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              paddingRight: "10px",
              width: "100%",
              height: "40px",
            }}
          >
            <span
              className="cloud-drive-label"
              style={{ width: "auto", fontSize: "16px" }}
            >
              <Trans>Add OPDS Catalog</Trans>
            </span>
          </div>
        )}
      </div>
  );
};

export default OPDSDialog;
