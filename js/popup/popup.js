/* global chrome, $ */
/* eslint-disable no-undef */

// Debug settings
const closeDialogAfterTimeout = true;
// Other constants and variables
const removeEditText = 'Remove Edit Panel From This Tab';
const openEditText = 'Open Edit Panel for this Tab';
const openEditTextConvertedPDF = 'Open Edit Panel for this PDF';
const highlightThisText = 'Highlight Candidates on This Tab';
const highlightThisPDF = 'Highlight Candidates found on this PDF';
const removeHighlightThisText = 'Remove Highlights From This Tab';
let pdfURL = null;

/*
Jan 2023:  We have converted the extension to use Chrome Extension Manifest V3 (API V3)
WE NO LONGER CAN USE chrome.runtime.getBackgroundPage() or chrome.runtime.sendMessage(), but we can use (chrome.tabs.sendMessage)
The V3 Chrome documentation is incorrect and outdated, and these older apis no longer work
*/

// Promise management
const promiseRegistry = new Set();

function registerPromise (promise) {
  promiseRegistry.add(promise);
  return promise.finally(() => {
    promiseRegistry.delete(promise);
  });
}

function cancelAllPromises () {
  promiseRegistry.forEach((promise) => {
    if (promise.cancel) promise.cancel();
  });
  promiseRegistry.clear();
}

// When popup.html is loaded by clicking on the WeVote "W" icon as specified in the manifest.json
document.addEventListener('DOMContentLoaded', function () {
  const {
    chrome: {
      tabs: { sendMessage, lastError, query },
      action: { setBadgeText },
    },
  } = window;
  console.log('hello from popup');

  // The DOM is loaded, now get the active tab number
  query(
    {
      active: true,
      currentWindow: true,
    },
    async function (tabs) {
      const [tab] = tabs;
      const { id: tabId, windowId, url } = tab;
      console.log('hello from after tabs query tab tabId = ', tabId, ' tab = ', tab);

      // await logFromPopup(tabId, ('tabId Initial message after getting active tabId: ' + tabId));
      console.log('after first log response', tabId);
      setupEventListeners(tabId, url);
      addButtonListeners(tabId, url);
      console.log('after addButtonListeners', tabId);

      const statePromise = registerPromise(getGlobalState());
      await statePromise.then((state) => {
        const lastDate = new Date(state.lastStateChange);
        const lastPlus12 = new Date(lastDate.getTime() + (12 * 60 * 60 * 1000));
        // console.log('tabId getGlobalState tabId = ', tabId, ' state.tabId ', state.tabId);
        if (
          state.tabId !== tabId ||
          state.url !== url ||
          lastPlus12 < new Date()
        ) {
          console.log(
            'Detected changes or outdated state, reinitializing global state.'
          );
          const initPromise = registerPromise(reInitializeGlobalState(''));
          initPromise.then(() => {
            const isFromPDF = url.toLowerCase().endsWith('.pdf');
            // console.log('tabId in document.addEventListener(\'DOMContentLoaded tabId =', tabId, ' state.tabId', state.tabId);

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
              console.log('Updated global state after reinitialization.');
              updateUI(tabId, windowId, url);
            });
          });
        } else {
          console.log(
            'No significant changes detected. Preserving current state.'
          );
          updateUI(tabId, windowId, url);
        }
      });
    }
  );

  function updateUI (tabId, windowId, url) {
    $('#tabNumber').text(tabId.toString());
    const urlParts = url.split('/');
    let formattedUrl = url;
    if (urlParts.length > 4) {
      formattedUrl = `${urlParts[2]} / ${urlParts[3]}`;
      if (urlParts.length > 5) {
        formattedUrl += `/${urlParts[4]}`;
      }
    }

    $('#windowNumber').text(windowId.toString());
    $('#hostName').text(formattedUrl);
    updateButtonDisplayedState();
  }

  async function updateButtonDisplayedState () {
    const statePromise = registerPromise(getGlobalState());
    await statePromise.
      then((state) => {
        const {
          organizationName,
          organizationWeVoteId,
          organizationTwitterHandle,
          url,
          showHighlights,
          showPanels,
        } = state;
        // console.log('tabId updateButtonDisplayedState getGlobalState tabId = ', tabId, ' state.tabId ', state.tabId);

        const isPDF = url.toLowerCase().endsWith('.pdf');
        if (isPDF) {
          if (!state.voterIsSignedIn) {
            $('.notLoggedInWarning').css('display', 'unset');
            $('#highlightCandidatesThisTabButton').css('display', 'none');
            $('#openEditPanelButton').css('display', 'none');
            return;
          }
        }

        updateButtonsBasedOnState(showHighlights, showPanels, isPDF);
        updateEndorsementsButton(
          organizationName,
          organizationWeVoteId,
          organizationTwitterHandle
        );
      }).catch((error) => {
        console.error('Failed to update button state:', error);
      });
  }

  function updateButtonsBasedOnState (showHighlights, showPanels, isPDF) {
    if (showHighlights) {
      $('#highlightCandidatesThisTabButton').addClass('weButtonRemove').removeClass('wePDF').text(removeHighlightThisText);
    } else if (isPDF) {
      $('#highlightCandidatesThisTabButton').removeClass('weButtonRemove').addClass('wePDF').text(highlightThisPDF);
    } else {
      $('#highlightCandidatesThisTabButton').removeClass('weButtonRemove').text(highlightThisText);
    }

    if (showPanels) {
      $('#openEditPanelButton').addClass('weButtonRemove').text(removeEditText);
    } else if (isPDF) {
      $('#openEditPanelButton').removeClass('weButtonRemove').text(openEditTextConvertedPDF);
    } else {
      $('#openEditPanelButton').removeClass('weButtonRemove').text(openEditText);
    }
  }

  function updateEndorsementsButton (
    organizationName,
    organizationWeVoteId,
    organizationTwitterHandle
  ) {
    if (organizationWeVoteId || organizationTwitterHandle) {
      const urlWebApp = organizationTwitterHandle
        ? `${webAppRoot}/${organizationTwitterHandle}`
        : `${webAppRoot}/voterguide/${organizationWeVoteId}`;
      $('#allEndorsementsButton').text(
        organizationName && organizationName.length
          ? 'Endorsements: ' + organizationName
          : 'Endorsements'
      ).prop('disabled', false).removeClass('weButtonDisable').off('click').on('click', () => window.open(urlWebApp, '_blank'));
    } else {
      const orgName = organizationName ? organizationName.toUpperCase() : '';
      $('#allEndorsementsButton').
        text('ENDORSEMENTS' + orgName).
        prop('disabled', true).
        addClass('weButtonDisable').
        off('click');
    }
  }

  function setupEventListeners (tabId, url) {
    $(document).on('click', '#resetThisTabButton', function () {
      console.log('Resetting tab', tabId);

      sendMessage(
        tabId,
        {
          command: 'hardResetActiveTab',
          payload: { tabUrl: url },
        },
        async () => {
          if (chrome.runtime.lastError) {
            console.error('Reset tab hardResetActiveTab error: ', chrome.runtime.lastError.message);
          } else {
            console.log('Tab reset successfully');
            cancelAllPromises();
            await registerPromise(reInitializeGlobalState(''));
            await registerPromise(updateButtonDisplayedState());
            setBadgeText({ text: '' });
            chrome.tabs.reload(tabId, {}, () => {
              chrome.runtime.reload();
              setTimeout(() => window.close(), 1000);
            });
          }
        }
      );
    });
  }
  function addButtonListeners (tabId, url) {
    // Reset the highlighted tab
    $('#resetThisTabButton').click(() => {
      console.log('addButtonListeners resetThisTabButton hardResetActiveTab click tabId', tabId);
      console.log('hardResetActiveTab popup.js location: ', location);
      logFromPopup(tabId, ('tabId sending hardResetActiveTab tabId = ', tabId));
      sendMessage(
        tabId,
        {
          command: 'hardResetActiveTab',
          payload: {
            tabUrl: url,
          },
        },
        async () => {
          console.log(
            lastError
              ? `resetThisTabButton lastError ${lastError.message}`
              : 'resetThisTabButton returned'
          );
          cancelAllPromises();
          await registerPromise(reInitializeGlobalState(''));
          await registerPromise(updateButtonDisplayedState());
          // addButtonListeners(tabId, url);
          setBadgeText({ text: '' });
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
    $('#highlightCandidatesThisTabButton').click(async () => {
      console.log('addButtonListeners highlightCandidatesThisTabButton click tabId', tabId);
      const statePromise = registerPromise(getGlobalState());
      await statePromise.then(async (state) => {
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
          await reInitializeGlobalState('');
        }
        logFromPopup(tabId, ('tabId in $(#highlightCandidatesThisTabButton).click( tabId =', tabId, ' state.tabId = ', state.tabId));
        sendMessage(
          tabId,
          {
            command: 'updateForegroundForButtonChange',
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
              console.log('updateForegroundForButtonChange 1 lastError', lastError.message);
            }
          }
        );
        await updateButtonDisplayedState();

        setTimeout(() => {
          closeDialogAfterTimeout && window.close();
        }, 1000);
      });
    });

    // Open Edit Panel For This Tab
    const openEditPanelButtonSelector = $('#openEditPanelButton');
    openEditPanelButtonSelector.click(async () => {
      console.log('openEditPanelButton button onClick -- popup.js');
      // let showPanels = false;
      // let showHighlights = false;
      // let newTabId = tabId;
      // const isFromPDF = pdfURL && pdfURL.length > 0;

      const statePromise = registerPromise(getGlobalState());
      await statePromise.then(async (state) => {
        let showPanels = !state.showPanels;
        let showHighlights = showPanels; // Assuming that showing panels implies highlighting
        const isFromPDF = pdfURL && pdfURL.endsWith('.pdf');

        await registerPromise(
          updateGlobalState({
            isFromPDF: isFromPDF,
            pdfURL: pdfURL,
            showPanels: showPanels,
            showHighlights: showHighlights,
            tabId: showPanels ? tabId : -1, // Use -1 as tabId to indicate removal
          })
        );

        logFromPopup(tabId, ('tabId sending updateForegroundForButtonChange tabId = ' + tabId));
        sendMessage(tabId, {
          command: 'updateForegroundForButtonChange',
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

  function logFromPopup (tabId, message) {
    if (debugPopUpMessages) {
      sendMessage(tabId, {
        command: 'logFromPopup',
        payload: message,
      });
    }
  }
});
