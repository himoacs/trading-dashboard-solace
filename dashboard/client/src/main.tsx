import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Error handling for app initialization
try {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Failed to find the root element");

  createRoot(rootElement).render(<App />);
  console.log("App rendered successfully");
} catch (error) {
  console.error("Error initializing the application:", error);
  // Display fallback UI if the app fails to load
  const rootElement = document.getElementById("root");
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 2rem; text-align: center;">
        <h1>SolCapital Dashboard</h1>
        <p>Error loading the application. Please refresh the page to try again.</p>
      </div>
    `;
  }
}
