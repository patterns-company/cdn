(function () {
  const queue = window.ptrns?.q || [];
  const config = {
    apiBaseUrl: 'https://api.patterns.company/v1' // Default production API URL
  };
  let storedPattern = null;
  let observer = null;
  let enforceLock = false;
  let currentSessionId = null;
  let debug = false; // Initialize debug flag

  const observeConfig = {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true
  };

  queue.forEach(([command, params]) => {
    if (command === 'init') {
      Object.assign(config, params);
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  const patternIdFromQuery = urlParams.get('pattern');
  const debugFromQuery = urlParams.get('debug');

  if (debugFromQuery === 'true') {
    debug = true;
  }

  // Define your API base URL - now from config or default
  const apiBaseUrl = config.apiBaseUrl;

  const log = (level, ...args) => {
    // Define emojis for each log level
    const emojis = {
      info: '✨',    // For informational messages
      warn: '⚠️',    // For warnings
      error: '🔥'   // For errors
    };

    // Get the appropriate emoji, default to an empty string if not found
    const emoji = emojis[level] || '';

    if (debug || level === 'error') { // Always show errors, otherwise check debug flag
      console[level](`${emoji} Patterns:`, ...args); // Prepend emoji and "Patterns:"
    }
  };

  if (!patternIdFromQuery) {
    log("warn", "'pattern' parameter is missing from the query string. Changes will not be applied.");
    return;
  }

  // IMPORTANT: Ensure config.id (your snippet ID) is present from the init call
  if (!config.id) {
    log("error", "Initialization ID (config.id) is missing. Cannot fetch pattern data.");
    return;
  }

  // This route now correctly uses :snippetId (config.id) and :patternId in the URL order
  const patternApiEndpoint = `${apiBaseUrl}/pattern/${config.id}/${patternIdFromQuery}`;
  const sessionCreateEndpoint = `${apiBaseUrl}/sessions`;
  const sessionEventsEndpoint = (sessionId) => `${apiBaseUrl}/sessions/${sessionId}/events`;

  function waitForCurrentIframeLoad(iframe, timeout = 10000) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status) => {
        if (!settled) {
          log("info", `Original iframe ${status}: ${iframe.src}`);
          settled = true;
          resolve();
        }
      };
      iframe.onload = () => finish("loaded");
      iframe.onerror = () => finish("errored");
      setTimeout(() => finish("timed out"), timeout);
    });
  }

  function safelyUpdateIframeSrc(iframe, newSrc, timeout = 10000) {
    return new Promise((resolve) => {
      const currentSrc = iframe.getAttribute("src");

      if (currentSrc === newSrc) {
        log("info", `Iframe src is already up to date: ${newSrc}`);
        resolve("skipped");
        return;
      }

      if (!currentSrc || currentSrc === "about:blank") {
        log("info", "No current src. Setting iframe directly.");
        iframe.onload = () => resolve("loaded directly");
        iframe.onerror = () => resolve("error directly");
        iframe.setAttribute("src", newSrc);
        return;
      }

      waitForCurrentIframeLoad(iframe, timeout).then(() => {
        log("info", `Replacing iframe src from ${currentSrc} ➜ ${newSrc}`);
        iframe.onload = () => resolve("loaded updated");
        iframe.onerror = () => resolve("error updated");
        iframe.setAttribute("src", newSrc);
      });
    });
  }

  function applyPatternData(pattern) {
    if (!pattern || !Array.isArray(pattern.content)) {
      log("warn", "No valid pattern data to apply.");
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

    const iframeLoadPromises = [];

    pattern.content.forEach((item) => {
      const attribute = typeToAttribute[item.type];
      if (item.selector && attribute && item.payload != null) {
        const elements = document.querySelectorAll(item.selector);
        elements.forEach((el) => {
          switch (attribute) {
            case "textContent":
              log("info", `[Changes] Updating text on '${item.selector}'`);
              el.textContent = item.payload;
              break;

            case "innerHTML":
              log("info", `[Changes] Updating html on '${item.selector}'`);
              el.innerHTML = item.payload;
              break;

            case "src":
              if (el.tagName.toLowerCase() === "img") {
                const currentSrc = el.getAttribute("src");
                if (currentSrc !== item.payload) {
                  checkImageExists(item.payload).then((exists) => {
                    if (exists) {
                      el.removeAttribute("srcset");
                      el.setAttribute("src", item.payload);
                    } else {
                      log("warn", `[Changes] Resource not found at ${item.payload}`);
                    }
                  });
                } else {
                  log("info", `[Changes] Image src already set: ${item.payload}`);
                }
              } else if (el.tagName.toLowerCase() === "iframe") {
                log("info", `[Changes] Updating src attribute on iframe '${item.selector}'`);
                iframeLoadPromises.push(safelyUpdateIframeSrc(el, item.payload));
              } else {
                log("info", `[Changes] Updating src attribute on '${item.selector}'`);
                el.setAttribute("src", item.payload);
              }
              break;

            default:
              log("info", `[Changes] Updating attribute '${attribute}' on '${item.selector}'`);
              el.setAttribute(attribute, item.payload);
              break;
          }
        });
      }
    });

    Promise.all(iframeLoadPromises).then(() => {
      log("info", "All iframes loaded. Dispatching 'patternsRendered'");
      document.dispatchEvent(new CustomEvent("patternsRendered", {
        detail: { patternId: patternIdFromQuery }
      }));
    });
  }

  function sendAnalyticsEvents(events) {
    if (!currentSessionId) {
      log("warn", "[Analytics] No session ID available to send events.");
      return;
    }
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    const analyticsPayload = { events: events };

    // Using fetch with keepalive and credentials: 'omit'
    fetch(sessionEventsEndpoint(currentSessionId), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(analyticsPayload),
        credentials: 'omit', // Crucial: Do NOT send cookies or other credentials
        keepalive: true      // Ensures the request can complete even if the page unloads
    })
    .then(response => {
        if (!response.ok) {
            log("warn", `[Analytics] Failed to send events (status: ${response.status})`);
        } else {
            log("info", "[Analytics] Events sent successfully via fetch.");
        }
    })
    .catch(error => {
        log("error", "[Analytics] Error sending events via fetch:", error);
    });
  }

  const setupViewTracking = (element, analyticsId) => {
    let hasBeenViewed = false;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !hasBeenViewed) {
          hasBeenViewed = true;
          sendAnalyticsEvents([{
            id: analyticsId,
            eventType: 'view',
            timestamp: new Date().toISOString()
          }]);
          log("info", `[Analytics] '${analyticsId}' viewed.`);
          observer.disconnect();
        }
      });
    }, { threshold: 0.5 });
    observer.observe(element);
    return observer;
  };

  const setupClickTracking = (element, analyticsId) => {
    const handler = () => {
      sendAnalyticsEvents([{
        id: analyticsId,
        eventType: 'click',
        timestamp: new Date().toISOString()
      }]);
      log("info", `[Analytics] '${analyticsId}' clicked.`);
    };
    element.addEventListener('click', handler);
    return handler;
  };

  fetch(patternApiEndpoint)
    .then((response) => {
      if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
      return response.json();
    })
    .then(async (patternData) => {
      if (!patternData?.content?.length) {
        log("warn", "No valid pattern content found.");
        return;
      }
      if (patternData.status !== "completed") {
        log("warn", "Pattern status is not 'completed'.");
        return;
      }

      storedPattern = patternData;
      log("info", "Pattern data fetched successfully.");

      try {
        const sessionResponse = await fetch(sessionCreateEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pattern: patternIdFromQuery,
            userAgent: navigator.userAgent,
            ipAddress: 'UNKNOWN'
          }),
          credentials: 'omit' // Crucial: Do NOT send cookies or other credentials for session creation
        });
        if (!sessionResponse.ok) throw new Error(`Failed to create session: ${sessionResponse.status}`);
        const session = await sessionResponse.json();
        currentSessionId = session.id; // Correctly accessing 'id' from the response body
        log("info", `[Analytics] Session created with ID: ${currentSessionId}`);
      } catch (error) {
        log("error", "[Analytics] Error creating session:", error);
      }

      applyPatternData(storedPattern);

      if (currentSessionId && Array.isArray(storedPattern.analytics)) {
        storedPattern.analytics.forEach(analyticsItem => {
          const elements = document.querySelectorAll(analyticsItem.selector);
          if (elements.length > 0) {
            elements.forEach(element => {
              if (analyticsItem.type === 'view') {
                setupViewTracking(element, analyticsItem.id);
              } else if (analyticsItem.type === 'click') {
                setupClickTracking(element, analyticsItem.id);
              }
            });
            log("info", `[Analytics] Tracking set up for '${analyticsItem.id}' on ${elements.length} elements.`);
          } else {
            log("warn", `[Analytics] No elements found for selector '${analyticsItem.selector}' for ID '${analyticsItem.id}'.`);
          }
        });
      } else if (!currentSessionId) {
        log("warn", "[Analytics] Skipping tracking setup as no session ID is available.");
      } else {
        log("info", "[Analytics] No analytics configuration found for this pattern.");
      }

      if (config.enforce) {
        log("info", "Enforce mode ON. Reapplying on any DOM change.");

        let debounceTimer;
        observer = new MutationObserver(() => {
          if (enforceLock) return;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            enforceLock = true;
            observer.disconnect();

            applyPatternData(storedPattern);
            if (currentSessionId && Array.isArray(storedPattern.analytics)) {
                storedPattern.analytics.forEach(analyticsItem => {
                    const elements = document.querySelectorAll(analyticsItem.selector);
                    elements.forEach(element => {
                        if (analyticsItem.type === 'view') {
                           setupViewTracking(element, analyticsItem.id);
                        } else if (analyticsItem.type === 'click') {
                           setupClickTracking(element, analyticsItem.id);
                        }
                    });
                });
            }
            observer.observe(document.body, observeConfig);
            enforceLock = false;
          }, 200);
        });

        observer.observe(document.body, observeConfig);
      }
    })
    .catch((error) => {
      log("error", "Error fetching or processing pattern data:", error);
    });

  window.ptrns = window.ptrns || {};
  window.ptrns.updatePatternDOM = function () {
    if (!storedPattern) {
      log("warn", "No stored pattern data to re-apply.");
      return;
    }

    log("info", "Manually re-applying stored pattern data.");
    if (observer) {
      enforceLock = true;
      observer.disconnect();
    }

    applyPatternData(storedPattern);
    if (currentSessionId && Array.isArray(storedPattern.analytics)) {
        storedPattern.analytics.forEach(analyticsItem => {
            const elements = document.querySelectorAll(analyticsItem.selector);
            elements.forEach(element => {
                if (analyticsItem.type === 'view') {
                    setupViewTracking(element, analyticsItem.id);
                } else if (analyticsItem.type === 'click') {
                    setupClickTracking(element, analyticsItem.id);
                }
            });
        });
    }

    if (observer) {
      observer.observe(document.body, observeConfig);
      enforceLock = false;
    }
  };
})();