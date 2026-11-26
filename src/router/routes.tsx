import BookList from "../containers/lists/bookList";
import EmptyPage from "../containers/emptyPage";
import BookStore from "../containers/bookStore";
import { WantToReadShelf } from "../containers/bookStore/component";

export const routes = [
  { path: "empty", component: EmptyPage },
  { path: "home", component: BookList },
  { path: "want-to-read", component: WantToReadShelf },
  { path: "store", component: BookStore },
];
