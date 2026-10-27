import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ProductsData } from "@shared/products";
import { ProductsContext, ProductsRefreshContext } from "./products-context";

/** Product cards change at most a few times a day (the workbench rewrites them in the background);
 *  task titles a few times a session. */
const POLL_MS = 20_000;

/** Polls `products:read` and shares the result with every sidebar row. Renders children unchanged
 *  when no cards are configured — rows then just skip their product tag. Topic edits hand back the
 *  fresh data through the refresh context so the sidebar follows at once. */
export function ProductsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProductsData | null>(null);
  const refresh = useCallback((next?: ProductsData | null) => {
    if (next !== undefined) {
      setData(next);
      return;
    }
    window.api
      .readProducts()
      .then(setData)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  return (
    <ProductsRefreshContext.Provider value={refresh}>
      <ProductsContext.Provider value={data}>
        {children}
      </ProductsContext.Provider>
    </ProductsRefreshContext.Provider>
  );
}
