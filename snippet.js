(function () {
  const queue = window.ptrns?.q || [];
  const config = {};

  // Process queued calls, e.g. config.enforce = true
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

  // Fetch the pattern data
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

      // Process the first pattern in the response
      const pattern = data;
      if (pattern.status !== "generating" || !pattern.content) {
        console.warn("Patterns: Pattern data is not ready or missing content.");
        return;
      }

      // Define a mapping of types to attribute names
      const typeToAttribute = {
        text: "textContent",
        href: "href",
        src: "src",
        html: "innerHTML"
      };

      // Keep track of which elements were updated (for the enforce option)
      const updatedElements = [];

      // Iterate over the content field and update the DOM
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

      // Dispatch a custom event after updates are complete
      const renderedEvent = new CustomEvent("patternsRendered", {
        detail: { patternId: patternIdFromQuery }
      });
      document.dispatchEvent(renderedEvent);

      // --- OPTIONAL: Enforce pattern changes if config.enforce is true ---
      if (config.enforce === true) {
        console.info("Patterns: Enforce mode is ON. Monitoring DOM changes for updated elements.");

        let isProgrammaticChange = false;
        const observer = new MutationObserver((mutations) => {
          // Avoid re-triggering if the script itself is making the change
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
              const found = updatedElements.find(u => u.element === parentEl && u.attribute === "textContent");
              if (found) {
                // If the text changed from our enforced value, revert it
                if (parentEl.textContent !== found.value) {
                  isProgrammaticChange = true;
                  parentEl.textContent = found.value;
                  console.warn(`Patterns (enforce): Reverted textContent for selector: ${parentEl.tagName}.`);
                }
              }
            }

            // If it's an attribute change
            else if (mutation.type === "attributes") {
              const targetEl = mutation.target;
              const attrName = mutation.attributeName;

              // Check if this element is one we updated, and if the changed attribute matches
              const found = updatedElements.find(u => u.element === targetEl);
              if (found && (found.attribute === attrName || found.attribute === "textContent")) {
                // For textContent, there's no "textContent" attribute, so we skip that
                if (found.attribute === attrName) {
                  // If the current attribute value differs from the enforced one, revert it
                  const currentVal = targetEl.getAttribute(attrName);
                  if (currentVal !== found.value) {
                    isProgrammaticChange = true;
                    targetEl.setAttribute(attrName, found.value);
                    console.warn(`Patterns (enforce): Reverted ${attrName} for selector: ${targetEl.tagName}.`);
                  }
                }
              }
            }
          });
        });

        // Observe the entire document body for attribute or characterData changes
        observer.observe(document.body, {
          subtree: true,
          childList: true,      // needed to observe text node additions/removals
          attributes: true,
          characterData: true
        });
      }
      // --- END OPTIONAL ENFORCE SECTION ---

    })
    .catch((error) => {
      console.error("Patterns: Error fetching or processing pattern data:", error);
    });
})();