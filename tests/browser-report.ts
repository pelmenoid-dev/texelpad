export type BrowserResult = {
  name: string;
  pass: boolean;
  detail?: string;
  error?: string;
};
export type BrowserReport = {
  suite: string;
  tests: BrowserResult[];
  error?: string;
};
declare global {
  interface Window {
    __testReport?: BrowserReport;
  }
}

// The isolated test runner reads results from this page; no dev-server filesystem API.
export function reportResults(report: BrowserReport) {
  window.__testReport = report;
  document.title = `${!report.error && report.tests.every(test => test.pass) ? 'PASS' : 'FAIL'} · ${report.suite}`;
}
