/* global chrome, $, AbortController */
/* eslint-disable no-undef */

// Debug settings
const closeDialogAfterTimeout = true;
const showTabAndWindowInPopup = true;
// Other constants and variables
const removeEditText = "Remove Edit Panel From This Tab";
const openEditText = "Open Edit Panel for this Tab";
const openEditTextConvertedPDF = "Open Edit Panel for this PDF";
const highlightThisText = "Highlight Candidates on This Tab";
const highlightThisPDF = "Highlight Candidates found on this PDF";
const removeHighlightThisText = "Remove Highlights From This Tab";
let pdfURL = null;

/*
Jan 2023:  We have converted the extension to use Chrome Extension Manifest V3 (API V3)
WE NO LONGER CAN USE chrome.runtime.getBackgroundPage() or chrome.runtime.sendMessage() -- The V3 Chrome documentation is incorrect and outdated, and these no longer work
*/

// Promise management
const promiseRegistry = new Set();

function registerPromise(promise) {
  promiseRegistry.add(promise);
  return promise.finally(() => {
    promiseRegistry.delete(promise);
  });
}

function cancelAllPromises() {
  promiseRegistry.forEach(promise => {
    if (promise.cancel) promise.cancel();
  });
  promiseRegistry.clear();
}

// When popup.html is loaded by clicking on the WeVote "W" icon as specified in the manifest.json
document.addEventListener("DOMContentLoaded", function () {
  const {
    chrome: {
      tabs: { sendMessage, lastError, query },
      action: { setBadgeText },
    },
  } = window;
  console.log("hello from popup");

  // The DOM is loaded, now get the active tab number
  query(
    {
      active: true,
      currentWindow: true,
    },
    async function (tabs) {
      const [tab] = tabs;
      const { id: tabId, windowId, url } = tab;
      console.log("hello from after tabs query tab tabId", tabId, tab);
      logFromPopup(
        tabId,
        "Initial message after getting active tabId: " + tabId
      );
      console.log("after first log response", tabId);
      setupEventListeners(tabId, url);
      addButtonListeners(tabId, url);
      console.log("after addButtonListeners", tabId);

      const statePromise = registerPromise(getGlobalState());
      statePromise.then(state => {
        const lastDate = new Date(state.lastStateChange);
        const lastPlus12 = new Date(lastDate.getTime() + 12 * 60 * 60 * 1000);

        if (
          state.tabId !== tabId ||
          state.url !== url ||
          lastPlus12 < new Date()
        ) {
          console.log(
            "Detected changes or outdated state, reinitializing global state."
          );
          const initPromise = registerPromise(reInitializeGlobalState(url));
          initPromise.then(() => {
            const isFromPDF = url.toLowerCase().endsWith(".pdf");
            const updateStatePromise = registerPromise(
              updateGlobalState({
                tabId,
                windowId,
                url,
                isFromPDF,
                lastStateChange: Date.now(),
              })
            );
            updateStatePromise.then(() => {
              console.log("Updated global state after reinitialization.");
              updateUI(tabId, windowId, url);
            });
          });
        } else {
          console.log(
            "No significant changes detected. Preserving current state."
          );
          updateUI(tabId, windowId, url);
        }
      });
    }
  );

  function updateUI(tabId, windowId, url) {
    $("#tabNumber").text(tabId.toString());
    const urlParts = url.split("/");
    let formattedUrl = url;
    if (urlParts.length > 4) {
      formattedUrl = `${urlParts[2]} / ${urlParts[3]}`;
      if (urlParts.length > 5) {
        formattedUrl += `/${urlParts[4]}`;
      }
    }

    $("#windowNumber").text(windowId.toString());
    $("#hostName").text(formattedUrl);
    updateButtonDisplayedState();
  }
  // console.log('state: ' + state.tabId + ' ->' + tabId + ' :: ' +
  //   state.windowId + ' ->' + windowId + ' :: ' +
  //   state.url + ' ->' + url);
  // const lastDate = new Date(state.lastStateChange);
  // const lastPlus12 = lastDate.setHours(lastDate.getHours() + 12);
  // if (state.tabId !== tabId || /* state.windowId !== windowId ||*/ state.url !== url || lastPlus12 < Date.now()) {
  //   console.log('RESETTING STORAGE DUE TO TAB CHANGE OR OUTDATED STORAGE ', state.tabId, tabId, state.windowId, windowId, state.url, url, lastPlus12, Date.now());
  //   await reInitializeGlobalState(url);
  //   let isFromPDF = false;
  //   if (url && url.length > 5) {
  //     isFromPDF = url.toLowerCase().endsWith('.pdf');
  //   }
  //   await updateGlobalState({
  //     tabId: tabId,
  //     windowId: windowId,
  //     url: url,
  //     isFromPDF: isFromPDF,
  //     lastStateChange: Date.now(),
  //   });
  //   debugStorage('reinitialized state tabId: ' + tabId + ', windowId ' + windowId + ', url: ' + url);
  //   logFromPopup (tabId, '--------------- reinitialized state tabId: ' + tabId + ', windowId ' + windowId + ', url: ' + url);
  //   chrome.action.setBadgeText({text: ''});
  // } else {
  //   debugStorage('PRESERVING STORAGE ON POPUP OPEN');
  // }
  // await updateButtonDisplayedState();

  //   $('#tabNumber').text(tabId.toString());
  //   const bits = url.split('/');
  //   let u = url;
  //   if (bits.length > 4) {
  //     u = bits[2] + ' /' + bits[3];
  //   }
  //   if (bits.length > 5) {
  //     u += '/' + bits[4];
  //   }
  //   if (showTabAndWindowInPopup) {
  //     $('#windowNumber').text(windowId.toString());
  //     $('#hostName').text(u);
  //   } else {
  //     $('.tabReportDiv').attr('hidden', true);
  //   }
  // });

  async function updateButtonDisplayedState() {
    const statePromise = registerPromise(getGlobalState());
    statePromise
      .then(state => {
        const {
          organizationName,
          organizationWeVoteId,
          organizationTwitterHandle,
          url,
          showHighlights,
          showPanels,
        } = state;

        const isPDF = url.toLowerCase().endsWith(".pdf");
        if (isPDF) {
          if (!state.voterIsSignedIn) {
            $(".notLoggedInWarning").css("display", "unset");
            $("#highlightCandidatesThisTabButton").css("display", "none");
            $("#openEditPanelButton").css("display", "none");
            return;
          }
        }

        updateButtonsBasedOnState(showHighlights, showPanels, isPDF);
        updateEndorsementsButton(
          organizationName,
          organizationWeVoteId,
          organizationTwitterHandle
        );
      })
      .catch(error => {
        console.error("Failed to update button state:", error);
      });
  }

  function updateButtonsBasedOnState(showHighlights, showPanels, isPDF) {
    if (showHighlights) {
      $("#highlightCandidatesThisTabButton")
        .addClass("weButtonRemove")
        .removeClass("wePDF")
        .text(removeHighlightThisText);
    } else if (isPDF) {
      $("#highlightCandidatesThisTabButton")
        .removeClass("weButtonRemove")
        .addClass("wePDF")
        .text(highlightThisPDF);
    } else {
      $("#highlightCandidatesThisTabButton")
        .removeClass("weButtonRemove")
        .text(highlightThisText);
    }

    if (showPanels) {
      $("#openEditPanelButton").addClass("weButtonRemove").text(removeEditText);
    } else if (isPDF) {
      $("#openEditPanelButton")
        .removeClass("weButtonRemove")
        .text(openEditTextConvertedPDF);
    } else {
      $("#openEditPanelButton")
        .removeClass("weButtonRemove")
        .text(openEditText);
    }
  }

  function updateEndorsementsButton(
    organizationName,
    organizationWeVoteId,
    organizationTwitterHandle
  ) {
    if (organizationWeVoteId || organizationTwitterHandle) {
      const urlWebApp = organizationTwitterHandle
        ? "https://wevote.us/" + organizationTwitterHandle
        : "https://wevote.us/voterguide/" + organizationWeVoteId;
      $("#allEndorsementsButton")
        .text(
          organizationName && organizationName.length
            ? "Endorsements: " + organizationName
            : "Endorsements"
        )
        .prop("disabled", false)
        .removeClass("weButtonDisable")
        .off("click")
        .on("click", () => window.open(urlWebApp, "_blank"));
    } else {
      const orgName = organizationName ? organizationName.toUpperCase() : "";
      $("#allEndorsementsButton")
        .text("ENDORSEMENTS" + orgName)
        .prop("disabled", true)
        .addClass("weButtonDisable")
        .off("click");
    }
  }

  function setupEventListeners(tabId, url) {
    $(document).on("click", "#resetThisTabButton", function () {
      console.log("Resetting tab", tabId);
      sendMessage(
        tabId,
        {
          command: "hardResetActiveTab",
          payload: { tabUrl: url },
        },
        async () => {
          if (chrome.runtime.lastError) {
            console.error("Reset tab error:", chrome.runtime.lastError.message);
          } else {
            console.log("Tab reset successfully");
            cancelAllPromises();
            await registerPromise(reInitializeGlobalState(url));
            await registerPromise(updateButtonDisplayedState());
            chrome.action.setBadgeText({ text: "" });
            chrome.tabs.reload(tabId, {}, () => {
              chrome.runtime.reload();
              setTimeout(() => window.close(), 1000);
            });
          }
        }
      );
    });
  }
  function addButtonListeners(tabId, url) {
    // Reset the highlighted tab
    $("#resetThisTabButton").click(() => {
      console.log(
        "addButtonListeners resetThisTabButton hardResetActiveTab click tabId",
        tabId
      );
      console.log("hardResetActiveTab popup.js location: ", location);
      logFromPopup(tabId, "sending hardResetActiveTab");
      sendMessage(
        tabId,
        {
          command: "hardResetActiveTab",
          payload: {
            tabUrl: url,
          },
        },
        async () => {
          console.log(
            lastError
              ? `resetThisTabButton lastError ${lastError.message}`
              : "resetThisTabButton returned"
          );
          cancelAllPromises();
          await registerPromise(reInitializeGlobalState(url));
          await registerPromise(updateButtonDisplayedState());
          // addButtonListeners(tabId, url);
          chrome.action.setBadgeText({ text: "" });
          chrome.tabs.reload(tabId, {}, () => {
            chrome.runtime.reload();
            setTimeout(() => {
              window.close();
            }, 1000);
          });
        }
      );
    });

    // Highlight Candidates on This Tab
    $("#highlightCandidatesThisTabButton").click(async () => {
      console.log(
        "addButtonListeners highlightCandidatesThisTabButton click tabId",
        tabId
      );
      console.log("getGlobalState in popup 137");
      const statePromise = registerPromise(getGlobalState());
      statePromise.then(async state => {
        statePromise.then;
        const showHighlights = !state.showHighlights;
        const showPanels = false;
        const isFromPDF = pdfURL && pdfURL.length > 0;

        if (showHighlights) {
          // $('#highlightingMasterSwitch').prop('checked', true);
          await updateGlobalState({
            showPanels: showPanels,
            showHighlights: showHighlights,
            tabId: tabId,
          });
        } else {
          await reInitializeGlobalState("");
        }
        // if (state.showHighlights) {
        //   $('#highlightingMasterSwitch').prop('checked', true);
        // }
        logFromPopup(tabId, "sending updateForegroundForButtonChange");
        sendMessage(
          tabId,
          {
            command: "updateForegroundForButtonChange",
            payload: {
              isFromPDF,
              showPanels,
              pdfURL,
              showHighlights,
              tabId,
              tabUrl: url,
            },
          },
          function (lastError) {
            if (lastError) {
              console.log(
                "updateForegroundForButtonChange 1 lastError",
                lastError.message
              );
            }
            console.log("updateForegroundForButtonChange: ", lastError);
          }
        );
        await updateButtonDisplayedState();

        setTimeout(() => {
          closeDialogAfterTimeout && window.close();
        }, 1000);
      });
    });

    // Open Edit Panel For This Tab
    const openEditPanelButtonSelector = $("#openEditPanelButton");
    openEditPanelButtonSelector.click(async () => {
      console.log("openEditPanelButton button onClick -- popup.js");
      console.log("getGlobalState in popup 179");
      let showPanels = false;
      let showHighlights = false;
      let newTabId = tabId;
      const isFromPDF = pdfURL && pdfURL.length > 0;

      const statePromise = registerPromise(getGlobalState());
      statePromise.then(async state => {
        let showPanels = !state.showPanels;
        let showHighlights = showPanels; // Assuming that showing panels implies highlighting
        const isFromPDF = pdfURL && pdfURL.endsWith(".pdf");

        await registerPromise(
          updateGlobalState({
            isFromPDF: isFromPDF,
            pdfURL: pdfURL,
            showPanels: showPanels,
            showHighlights: showHighlights,
            tabId: showPanels ? tabId : -1, // Use -1 as tabId to indicate removal
          })
        );

        logFromPopup(tabId, "sending updateForegroundForButtonChange");
        sendMessage(tabId, {
          command: "updateForegroundForButtonChange",
          payload: {
            isFromPDF,
            showPanels,
            pdfURL,
            showHighlights,
            tabId,
            tabUrl: url,
          },
        });
        await registerPromise(updateButtonDisplayedState());

        setTimeout(() => {
          if (closeDialogAfterTimeout) window.close();
        }, 1000);
      });
    });
  }

  function logFromPopup(tabId, message) {
    if (debugPopUpMessages) {
      sendMessage(tabId, {
        command: "logFromPopup",
        payload: message,
      });
    }
  }
});
