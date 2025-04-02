(function () {
  const queue = window.ptrns?.q || [];
  const config = {};
  let storedPattern = null;
  let observer = null;
  let enforceLock = false;

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

  if (!patternIdFromQuery) {
    console.warn("Patterns: 'pattern' parameter is missing from the query string.");
    return;
  }

  const apiEndpoint = `https://api.patterns.company/v1/pattern/${config.id}/${patternIdFromQuery}`;

  function waitForCurrentIframeLoad(iframe, timeout = 10000) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status) => {
        if (!settled) {
          console.info(`🧭 Original iframe ${status}: ${iframe.src}`);
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
        console.info(`⏭ Iframe src is already up to date: ${newSrc}`);
        resolve("skipped");
        return;
      }

      if (!currentSrc || currentSrc === "about:blank") {
        console.info("📦 No current src. Setting iframe directly.");
        iframe.onload = () => resolve("loaded directly");
        iframe.onerror = () => resolve("error directly");
        iframe.setAttribute("src", newSrc);
        return;
      }

      waitForCurrentIframeLoad(iframe, timeout).then(() => {
        console.info(`🔁 Replacing iframe src from ${currentSrc} ➜ ${newSrc}`);
        iframe.onload = () => resolve("loaded updated");
        iframe.onerror = () => resolve("error updated");
        iframe.setAttribute("src", newSrc);
      });
    });
  }

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

    const iframeLoadPromises = [];

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
                const currentSrc = el.getAttribute("src");
                if (currentSrc !== item.payload) {
                  checkImageExists(item.payload).then((exists) => {
                    if (exists) {
                      el.setAttribute("src", item.payload);
                    } else {
                      console.warn(`Patterns: Resource not found at ${item.payload}`);
                    }
                  });
                } else {
                  console.info(`⏭ Image src already set: ${item.payload}`);
                }
              } else if (el.tagName.toLowerCase() === "iframe") {
                iframeLoadPromises.push(safelyUpdateIframeSrc(el, item.payload));
              } else {
                el.setAttribute("src", item.payload);
              }
              break;

            default:
              el.setAttribute(attribute, item.payload);
              break;
          }
        });
      }
    });

    Promise.all(iframeLoadPromises).then(() => {
      console.info("Patterns: All iframes loaded. Dispatching 'patternsRendered'");
      document.dispatchEvent(new CustomEvent("patternsRendered", {
        detail: { patternId: patternIdFromQuery }
      }));
    });
  }

  fetch(apiEndpoint)
    .then((response) => {
      if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
      return response.json();
    })
    .then((pattern) => {
      if (!pattern?.content?.length) {
        console.warn("Patterns: No valid pattern content found.");
        return;
      }

      if (pattern.status !== "generating") {
        console.warn("Patterns: Pattern status is not 'generating'.");
        return;
      }

      storedPattern = pattern;
      applyPatternData(storedPattern);

      if (config.enforce) {
        console.info("Patterns: Enforce mode ON. Reapplying on any DOM change.");

        let debounceTimer;
        observer = new MutationObserver(() => {
          if (enforceLock) return;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            enforceLock = true;
            observer.disconnect();

            applyPatternData(storedPattern);
            observer.observe(document.body, observeConfig);
            enforceLock = false;
          }, 200);
        });

        observer.observe(document.body, observeConfig);
      }
    })
    .catch((error) => {
      console.error("Patterns: Error fetching or processing pattern data:", error);
    });

  window.ptrns = window.ptrns || {};
  window.ptrns.updatePatternDOM = function () {
    if (!storedPattern) {
      console.warn("Patterns: No stored pattern data to re-apply.");
      return;
    }

    console.info("Patterns: Manually re-applying stored pattern data.");
    if (observer) {
      enforceLock = true;
      observer.disconnect();
    }

    applyPatternData(storedPattern);

    if (observer) {
      observer.observe(document.body, observeConfig);
      enforceLock = false;
    }
  };
})();
