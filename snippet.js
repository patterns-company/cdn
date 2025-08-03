(function () {
  const queue = window.ptrns?.q || [];
  const config = {
    apiBaseUrl: 'https://api.patterns.company/v1'
  };
  let storedPattern = null;
  let observer = null;
  let enforceLock = false;
  let currentSessionId = null;
  let debug = false;

  const sectionTimers = new Map();
  let lastViewedSectionId = null;

  let isPageActive = true;
  const MIN_DURATION_THRESHOLD_MS = 1000;

  const eventsBuffer = [];
  const BATCH_INTERVAL_MS = 3000;
  let batchTimerId = null;

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

  const apiBaseUrl = config.apiBaseUrl;

  const log = (level, ...args) => {
    const emojis = {
      info: '✨',
      warn: '⚠️',
      error: '🔥'
    };
    const emoji = emojis[level] || '';
    if (debug || level === 'error') {
      console[level](`${emoji} Patterns:`, ...args);
    }
  };

  if (!patternIdFromQuery) {
    log("warn", "'pattern' parameter is missing from the query string. Changes will not be applied.");
    return;
  }

  if (!config.id) {
    log("error", "Initialization ID (config.id) is missing. Cannot fetch pattern data.");
    return;
  }

  const patternApiEndpoint = `${apiBaseUrl}/pattern/${config.id}/${patternIdFromQuery}`;
  const sessionCreateEndpoint = `${apiBaseUrl}/sessions`;
  const sessionEventsEndpoint = (sessionId) => `${apiBaseUrl}/sessions/${sessionId}/events`;

  function processEventsBuffer() {
    if (eventsBuffer.length === 0) {
      return;
    }
    const eventsToSend = [...eventsBuffer];
    eventsBuffer.length = 0;
    if (!currentSessionId) {
      log("warn", "[Analytics] No session ID available to send batched events. Clearing buffer.");
      return;
    }
    const analyticsPayload = { events: eventsToSend };
    fetch(sessionEventsEndpoint(currentSessionId), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(analyticsPayload),
        credentials: 'omit',
        keepalive: true
    })
    .then(response => {
        if (!response.ok) {
            log("warn", `[Analytics] Failed to send ${eventsToSend.length} batched events (status: ${response.status})`);
        } else {
            log("info", `[Analytics] ${eventsToSend.length} events sent successfully via fetch (batched).`);
        }
    })
    .catch(error => {
        log("error", "[Analytics] Error sending batched events via fetch:", error);
    });
  }

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
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }
    eventsBuffer.push(...events);
    log("info", `[Analytics] Added ${events.length} event(s) to buffer. Current buffer size: ${eventsBuffer.length}.`);
    if (batchTimerId === null) {
      batchTimerId = setInterval(processEventsBuffer, BATCH_INTERVAL_MS);
      log("info", `[Analytics] Batching timer started (interval: ${BATCH_INTERVAL_MS}ms).`);
    }
  }

  /**
   * NEW: A dedicated function for sending critical, non-buffered events immediately.
   * This is used specifically for click events that may lead to page unload.
   */
  function sendImmediateAnalyticsEvent(event) {
    if (!currentSessionId) {
      log("warn", "[Analytics] Cannot send immediate event: No session ID available.");
      return;
    }
    const analyticsPayload = { events: [event] };
    fetch(sessionEventsEndpoint(currentSessionId), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(analyticsPayload),
        credentials: 'omit',
        keepalive: true // This is the key to ensuring the request completes even on unload
    })
    .then(response => {
        if (!response.ok) {
            log("warn", `[Analytics] Failed to send immediate event (status: ${response.status})`);
        } else {
            log("info", `[Analytics] Immediate event sent successfully via fetch (keepalive).`);
        }
    })
    .catch(error => {
        log("error", "[Analytics] Error sending immediate event via fetch:", error);
    });
  }

  const endSectionDuration = (analyticsId, timestampISO) => {
    const timerData = sectionTimers.get(analyticsId);
    if (!timerData) return;
    const { startTime, accumulatedActiveDuration } = timerData;
    let finalDuration = accumulatedActiveDuration;
    if (startTime !== null) {
      finalDuration += (Date.now() - new Date(startTime).getTime());
    }
    if (finalDuration >= MIN_DURATION_THRESHOLD_MS) {
        sendAnalyticsEvents([{
            id: analyticsId,
            eventType: 'duration',
            timestamp: timestampISO,
            duration: finalDuration
        }]);
        log("info", `[Analytics] '${analyticsId}' duration calculated: ${finalDuration}ms.`);
    } else {
        log("info", `[Analytics] Skipping '${analyticsId}' duration (${finalDuration}ms) as it's below threshold.`);
    }
    sectionTimers.delete(analyticsId);
  };

  const setupViewTracking = (element, analyticsId) => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const now = Date.now();
        const currentTimeISO = new Date(now).toISOString();
        if (entry.isIntersecting) {
          if (lastViewedSectionId && lastViewedSectionId !== analyticsId) {
            endSectionDuration(lastViewedSectionId, currentTimeISO);
          }
          if (!sectionTimers.has(analyticsId) && isPageActive) {
            sectionTimers.set(analyticsId, {
              startTime: currentTimeISO,
              accumulatedActiveDuration: 0
            });
            log("info", `[Analytics] '${analyticsId}' view started.`);
            sendAnalyticsEvents([{
              id: analyticsId,
              eventType: 'view',
              timestamp: currentTimeISO
            }]);
          }
          lastViewedSectionId = analyticsId;
        } else {
          endSectionDuration(analyticsId, currentTimeISO);
          if (lastViewedSectionId === analyticsId) {
              lastViewedSectionId = null;
          }
        }
      });
    }, { threshold: [0, 0.5, 1.0] });
    observer.observe(element);
    return observer;
  };

  const setupClickTracking = (element, analyticsId) => {
    const handler = (event) => {
      const clickEventPayload = {
        id: analyticsId,
        eventType: 'click',
        timestamp: new Date().toISOString()
      };

      // Check if the element is a link that will cause navigation
      const isAnchor = element.tagName.toLowerCase() === 'a' && element.href;
      if (isAnchor) {
        // Prevent default navigation to ensure the analytics call can fire
        event.preventDefault();
        const href = element.href;

        // Send the event immediately using fetch with keepalive
        sendImmediateAnalyticsEvent(clickEventPayload);

        // A small delay to ensure the fetch call is initiated before redirecting
        // Keepalive will handle the rest during the page transition.
        setTimeout(() => {
          log("info", `[Analytics] Navigating to: ${href}`);
          window.location.href = href;
        }, 50);

      } else {
        // For non-link elements, use the standard batched approach
        sendAnalyticsEvents([clickEventPayload]);
        log("info", `[Analytics] '${analyticsId}' clicked.`);
      }
    };
    element.addEventListener('click', handler);
    return handler;
  };

  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    const currentTimeISO = new Date(now).toISOString();
    if (document.hidden) {
      log("info", "[Analytics] Page is hidden. Pausing duration tracking for all active sections.");
      isPageActive = false;
      sectionTimers.forEach((timerData, analyticsId) => {
        const { startTime, accumulatedActiveDuration } = timerData;
        if (startTime !== null) {
          const currentActiveSegment = now - new Date(startTime).getTime();
          sectionTimers.set(analyticsId, {
            startTime: null,
            accumulatedActiveDuration: accumulatedActiveDuration + currentActiveSegment
          });
        }
      });
    } else {
      log("info", "[Analytics] Page is visible again. Resuming duration tracking for all active sections.");
      isPageActive = true;
      sectionTimers.forEach((timerData, analyticsId) => {
        if (timerData.startTime === null) {
          sectionTimers.set(analyticsId, {
            startTime: currentTimeISO,
            accumulatedActiveDuration: timerData.accumulatedActiveDuration
          });
        }
      });
    }
  });

  window.addEventListener('beforeunload', () => {
    if (batchTimerId !== null) {
        clearInterval(batchTimerId);
        batchTimerId = null;
    }
    const eventsToSendImmediately = [];
    const now = Date.now();
    const currentTimeISO = new Date(now).toISOString();
    sectionTimers.forEach((timerData, analyticsId) => {
      const { startTime, accumulatedActiveDuration } = timerData;
      let finalDuration = accumulatedActiveDuration;
      if (startTime !== null) {
        finalDuration += (now - new Date(startTime).getTime());
      }
      if (finalDuration >= MIN_DURATION_THRESHOLD_MS) {
        eventsToSendImmediately.push({
            id: analyticsId,
            eventType: 'duration',
            timestamp: currentTimeISO,
            duration: finalDuration
        });
        log("info", `[Analytics] Finalizing '${analyticsId}' duration for unload: ${finalDuration}ms.`);
      } else {
          log("info", `[Analytics] Skipping final '${analyticsId}' duration (${finalDuration}ms) on unload as it's below threshold.`);
      }
    });
    if (eventsBuffer.length > 0) {
        eventsToSendImmediately.push(...eventsBuffer);
        eventsBuffer.length = 0;
    }
    if (eventsToSendImmediately.length > 0) {
        log("info", `[Analytics] Sending ${eventsToSendImmediately.length} events immediately on beforeunload.`);
        if (currentSessionId) {
            // Replaced navigator.sendBeacon with fetch with keepalive: true
            fetch(sessionEventsEndpoint(currentSessionId), {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({ events: eventsToSendImmediately }),
              credentials: 'omit',
              keepalive: true
            })
            .then(response => {
              if (!response.ok) {
                  log("warn", `[Analytics] Failed to send unload events (status: ${response.status})`);
              } else {
                  log("info", `[Analytics] Unload events sent successfully via fetch (keepalive).`);
              }
            })
            .catch(error => {
              log("error", "[Analytics] Error sending unload events via fetch:", error);
            });
        } else {
            log("warn", "[Analytics] Cannot send unload events: No session ID available.");
        }
    }
  });

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
            debug,
          }),
          credentials: 'omit'
        });
        if (!sessionResponse.ok) throw new Error(`Failed to create session: ${sessionResponse.status}`);
        const session = await sessionResponse.json();
        currentSessionId = session.id;
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
