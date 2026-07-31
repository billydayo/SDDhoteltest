# Interface Contracts

This feature is implemented as a browser-only application with no backend API, external service integration, or distributed system boundary.

The app therefore exposes no remote HTTP contracts or service interfaces. All application interactions are local to the browser and occur through:

- DOM events and page navigation within the SPA
- localStorage-backed state management
- browser-only Canvas processing for the photo risk score feature
- optional SheetJS-based export fallback for CSV/XLSX generation

Because there are no external interfaces, there are no network contract specifications to maintain for this feature.
