(function () {
  const queue = window.ptrns?.q || [];
  const config = {};
  let storedPattern = null;   // Will hold the fetched pattern data
  let observer = null;        // Will hold the MutationObserver if enforce is on
  let enforceLock = false;    // Prevent re-observing our own changes

  // Process queued calls for config
  queue.forEach((args) => {
    const [command, params] = args;
    if (command === 'init') {
      Object.assign(config, params);
    }
  });

  // Get the pattern ID from the query string
  const urlParams = new URLSearchParams(window.location.search);
  const patternIdFromQuery = urlParams.get('pattern');

  if (!patternIdFromQuery) {
    console.warn("Patterns: 'pattern' parameter is missing from the query string.");
    return;
  }

  // Define the API endpoint
  const apiEndpoint = `https://api.patterns.company/v1/pattern/${config.id}/${patternIdFromQuery}`;

  // Helper to apply pattern data to the DOM
  function applyPatternData(pattern) {
    if (!pattern || !Array.isArray(pattern.content)) {
      console.warn("Patterns: No valid pattern data to apply.");
      return;
    }

    const typeToAttribute = {
      text: "textContent",
      href: "href",
      src: "src",
      html: "innerHTML"
    };

    function checkImageExists(url) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onerror = () => resolve(false);
        img.onload = () => resolve(true);
        img.src = url;
      });
    }

    pattern.content.forEach((item) => {
      const attribute = typeToAttribute[item.type];
      if (item.selector && attribute && item.payload != null) {
        const elements = document.querySelectorAll(item.selector);
        elements.forEach((el) => {
          switch (attribute) {
            case "textContent":
              el.textContent = item.payload;
              break;
            case "innerHTML":
              el.innerHTML = item.payload;
              break;
            case "src":
              if (el.tagName.toLowerCase() === "img") {
                checkImageExists(item.payload).then((exists) => {
                  if (exists) {
                    el.setAttribute(attribute, item.payload);
                  } else {
                    console.warn(`Patterns: Resource not found at ${item.payload}`);
                  }
                });
              } else {
                el.setAttribute(attribute, item.payload);
              }
              break;
            default:
              el.setAttribute(attribute, item.payload);
              break;
          }
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
    .then((pattern) => {
      // Basic checks
      if (!pattern?.content?.length) {
        console.warn("Patterns: No valid pattern content found.");
        return;
      }
      if (pattern.status !== "generating") {
        console.warn("Patterns: Pattern status is not 'generating'.");
        return;
      }

      // Store the pattern for later re-application
      storedPattern = pattern;

      // Apply once on load
      applyPatternData(storedPattern);

      // Dispatch an event after initial render
      document.dispatchEvent(new CustomEvent("patternsRendered", {
        detail: { patternId: patternIdFromQuery }
      }));

      // If enforce is true, watch for ANY DOM change and re-apply
      if (config.enforce) {
        console.info("Patterns: Enforce mode ON. Reapplying on any DOM change.");

        observer = new MutationObserver(() => {
          // If we are the ones causing the change, skip
          if (enforceLock) return;

          // Temporarily disconnect so we don't observe our own changes
          enforceLock = true;
          observer.disconnect();

          // Re-apply the pattern data
          applyPatternData(storedPattern);

          // Reconnect the observer
          observer.observe(document.body, {
            childList: true,
            attributes: true,
            characterData: true,
            subtree: true
          });
          enforceLock = false;
        });

        // Start observing
        observer.observe(document.body, {
          childList: true,
          attributes: true,
          characterData: true,
          subtree: true
        });
      }
    })
    .catch((error) => {
      console.error("Patterns: Error fetching or processing pattern data:", error);
    });

  /**
   * Public method to manually re-apply the stored pattern data at any time.
   */
  window.ptrns = window.ptrns || {};
  window.ptrns.updatePatternDOM = function () {
    if (!storedPattern) {
      console.warn("Patterns: No stored pattern data to re-apply.");
      return;
    }
    console.info("Patterns: Manually re-applying stored pattern data.");
    // Temporarily disconnect the observer to avoid infinite loop
    if (observer) {
      enforceLock = true;
      observer.disconnect();
    }

    applyPatternData(storedPattern);

    // Reconnect if needed
    if (observer) {
      observer.observe(document.body, {
        childList: true,
        attributes: true,
        characterData: true,
        subtree: true
      });
      enforceLock = false;
    }
  };
})();