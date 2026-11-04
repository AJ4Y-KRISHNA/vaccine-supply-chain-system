// CRA exposes only REACT_APP_* values in the browser bundle. Keep this paired
// with SIMULATOR_MANUAL_OVERRIDES_ENABLED in the backend environment.
export const manualSimulatorConsoleEnabled =
  process.env.REACT_APP_SIMULATOR_MANUAL_OVERRIDES_ENABLED === "true";
