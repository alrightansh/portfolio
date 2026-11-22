// Entry for the reading pages (layouts/Page.astro). Everything here reuses ui.js, the flight's motion primitives.
import { initTransitions } from "./transition.js";
import { initChrome } from "./page-chrome.js";
import { initReveals } from "./page-reveal.js";
import { initFlows } from "./page-flow.js";
import { initNetworks } from "./page-network.js";
import { initTabs, initEquations } from "./page-widgets.js";

initTransitions();
initChrome();
initFlows();
initNetworks();
initTabs();
initEquations();
// Like the flight, wait (briefly) for the type so letters rise in their own shapes.
const fonts = document.fonts ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 700))]) : Promise.resolve();
fonts.then(() => initReveals());
