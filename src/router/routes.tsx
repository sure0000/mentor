import BookList from "../containers/lists/bookList";
import EmptyPage from "../containers/emptyPage";
import BookStore from "../containers/bookStore";

export const routes = [
  { path: "empty", component: EmptyPage },
  { path: "home", component: BookList },
  { path: "store", component: BookStore },
];
