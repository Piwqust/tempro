import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/screens.css";
import "./styles/v2.css";
import "./styles/period.css";
import "./styles/features.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadStore } from "./data/store";

loadStore();

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
