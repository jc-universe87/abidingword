import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "@/i18n";
import { StartupScreen } from "./StartupScreen";

interface Props {
  onError: (message: string) => void;
  children: ReactNode;
}

/** Catches rendering failures: the user sees a plain message, the log gets detail. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(`${error.name}: ${error.message}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (this.state.failed) {
      return (
        <StartupScreen message={i18n.t("app.startup.windowFailed")} />
      );
    }
    return this.props.children;
  }
}
