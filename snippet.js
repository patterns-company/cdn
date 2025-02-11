(function () {
  const queue = window.ptrns?.q || [];
  const config = {};
  let storedPattern = null;        // Holds the fetched pattern
  let updatedElements = [];        // Tracks elements updated by the script
  let observer = null;            // Will hold the MutationObserver reference

  // Process queued calls (e.g., { id: 'MY_PROJECT_ID', enforce: true })
  queue.forEach((args) => {
    const [command, params] = args;
    if (command === 'init') {
      Object.assign(config, params);
    }
  });

  // Get the pattern ID from the query string
  const urlParams = new URLSearchParams(window.location.search);
  const patternIdFromQuery = urlParams.get('pattern');

  // Proceed only if pattern ID exists
  if (!patternIdFromQuery) {
    console.warn("Patterns: 'pattern' parameter is missing from the query string.");
    return;
  }

  // Define the API endpoint
  const apiEndpoint = `https://api.patterns.company/v1/pattern/${config.id}/${patternIdFromQuery}`;

  // Core function to apply the pattern data to the DOM
  function applyPatternData(pattern) {
    if (!pattern || !Array.isArray(pattern.content)) {
      console.warn("Patterns: No valid pattern data to apply.");
      return;
    }

    // Define a mapping of types to attribute names
    const typeToAttribute = {
      text: "textContent",
      href: "href",
      src: "src",
      html: "innerHTML"
    };

    // Clear the previously tracked elements so we don't double-track them
    updatedElements = [];

    // Iterate over the pattern content field and update the DOM
    pattern.content.forEach((item) => {
      const attribute = typeToAttribute[item.type];
      if (item.selector && attribute && item.payload) {
        const elements = document.querySelectorAll(item.selector);
        elements.forEach((el) => {
          // Apply the update
          if (attribute === "textContent") {
            el.textContent = item.payload;
          } else if (attribute === "innerHTML") {
            el.innerHTML = item.payload;
          } else {
            el.setAttribute(attribute, item.payload);
          }

          // Store the data needed to re-apply later if config.enforce is true
          updatedElements.push({ element: el, attribute, value: item.payload });
        });
      }
    });
  }

  // Fetch pattern data
  fetch(apiEndpoint)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data.content) || data.content.length === 0) {
        console.warn("Patterns: No valid pattern data found.");
        return;
      }

      // Assume the response is a single pattern object
      const pattern = data;
      if (pattern.status !== "generating" || !pattern.content) {
        console.warn("Patterns: Pattern data is not ready or missing content.");
        return;
      }

      // Store the fetched pattern globally so we can re-apply it
      storedPattern = pattern;

      // Apply the pattern data to the DOM
      applyPatternData(storedPattern);

      // Dispatch an event after initial render
      const renderedEvent = new CustomEvent("patternsRendered", {
        detail: { patternId: patternIdFromQuery }
      });
      document.dispatchEvent(renderedEvent);

      // Optional: Enforce mode using MutationObserver
      if (config.enforce === true) {
        console.info("Patterns: Enforce mode is ON. Monitoring DOM changes for updated elements.");

        let isProgrammaticChange = false;
        observer = new MutationObserver((mutations) => {
          // Prevent infinite loop if we are re-applying the same values
          if (isProgrammaticChange) {
            isProgrammaticChange = false;
            return;
          }

          mutations.forEach((mutation) => {
            // If it's a characterData change, the target is a text node
            if (mutation.type === "characterData") {
              const parentEl = mutation.target.parentElement;
              if (!parentEl) return;

              // Check if this parentEl is one of our updated elements
              const found = updatedElements.find(
                (u) => u.element === parentEl && u.attribute === "textContent"
              );
              if (found) {
                // If the text changed from our enforced value, revert it
                if (parentEl.textContent !== found.value) {
                  isProgrammaticChange = true;
                  parentEl.textContent = found.value;
                  console.warn(
                    `Patterns (enforce): Reverted textContent for ${parentEl.tagName}.`
                  );
                }
              }
            }
            // If it's an attribute change
            else if (mutation.type === "attributes") {
              const targetEl = mutation.target;
              const attrName = mutation.attributeName;

              const found = updatedElements.find((u) => u.element === targetEl);
              if (found) {
                // For textContent, there's no attribute, so skip
                if (found.attribute === attrName) {
                  // If the current attribute value differs from the enforced one, revert
                  const currentVal = targetEl.getAttribute(attrName);
                  if (currentVal !== found.value) {
                    isProgrammaticChange = true;
                    targetEl.setAttribute(attrName, found.value);
                    console.warn(
                      `Patterns (enforce): Reverted ${attrName} for ${targetEl.tagName}.`
                    );
                  }
                }
              }
            }
          });
        });

        // Observe the entire document body for attribute/characterData changes
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true
        });
      }
    })
    .catch((error) => {
      console.error("Patterns: Error fetching or processing pattern data:", error);
    });

  /**
   * Public method to re-apply the stored pattern data to the DOM.
   * Call `window.ptrns.updatePatternDOM()` whenever you want to “force” a re-render.
   */
  window.ptrns = window.ptrns || {};
  window.ptrns.updatePatternDOM = function () {
    if (!storedPattern) {
      console.warn("Patterns: No stored pattern data to re-apply.");
      return;
    }
    console.info("Patterns: Re-applying stored pattern data to the DOM.");
    applyPatternData(storedPattern);
  };
})();