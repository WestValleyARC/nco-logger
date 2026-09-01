/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import { HttpClient } from '#@client/lib/old__clientUtils.js';

(async function () {
    const userProfileApi = new HttpClient('userprofile', '/api/data/userprofiles');

    // Begin Account Deletion Logic:

    const deleteOutputElem = document.getElementById('delete_output');
    const accountDelModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('account_delete_modal'));
    const deleteConfirmationElem = document.getElementById('delete_confirmation');
    const deleteModalTitleElem = document.getElementById('account_delete_modal_title');
    const cancelDeleteBtn = document.getElementById('cancel_delete_account_btn');
    const confirmDeleteBtn = document.getElementById('confirm_delete_my_account_btn');
    const undeleteBtn = document.getElementById('undelete_my_account_btn');
    let userData;

    try {
        ({ status, data: userData } = await userProfileApi.index());

        if (status == 200) {
            document.getElementById('delete_my_account_btn').addEventListener('click', () => {
                deleteModalTitleElem.textContent = 'Delete Account';
                deleteConfirmationElem.hidden = false;
                deleteOutputElem.hidden = true;
                deleteOutputElem.textContent = '';
                cancelDeleteBtn.hidden = false;
                cancelDeleteBtn.textContent = 'Cancel';
                confirmDeleteBtn.hidden = false;
                confirmDeleteBtn.disabled = false;
                undeleteBtn.hidden = true;
            });

            confirmDeleteBtn.addEventListener('click', async () => {
                confirmDeleteBtn.disabled = true;
                await userProfileApi.delete(userData._id);

                deleteModalTitleElem.textContent = 'Account Marked for Deletion';
                deleteConfirmationElem.hidden = true;
                deleteOutputElem.hidden = false;
                deleteOutputElem.innerHTML = `Account: ${userData._id} <strong>marked for deletion</strong><br>If delete request was made in error, choose UNDELETE here:`;
                cancelDeleteBtn.textContent = 'Close';
                confirmDeleteBtn.hidden = true;
                undeleteBtn.hidden = false;

                setTimeout(() => {
                    accountDelModal.hide();
                }, 20000);

                setTimeout(() => {
                    window.location.replace('/views/myaccount');
                }, 20000);
            });

            undeleteBtn.addEventListener('click', async () => {
                await axios.get('/api/util/undeleteme');
                deleteOutputElem.innerHTML = `Account: ${userData._id} delete flag <strong>removed</strong>.`;
                undeleteBtn.hidden = true;

                setTimeout(() => {
                    accountDelModal.hide();
                }, 5000);
            });
        } else {
            throw new Error('userprofile api reponded with an error');
        }
    } catch (error) {
        if (error.response?.data.errorMessage) {
            console.error(error.response.data.errorMessage);
        } else {
            console.error(error);
        }
    }

    //End Account Deletion Logic
    //Begin Option Processing Logic:

    document.querySelectorAll('.flexOption').forEach(switchElem => {
        switchElem.checked = userData.computedFlexOptions.option[switchElem.id.replace('flexOpt-', '')];
    });

    document.getElementById('dataprivacy_form').addEventListener('change', async e => {
        if (e.target.classList.contains('flexOption')) {
            const newData = {
                flexOptions: {
                    option: {}
                }
            };

            document.querySelectorAll('.flexOption').forEach(switchElem => {
                newData.flexOptions.option[switchElem.id.replace('flexOpt-', '')] = switchElem.checked;
            });

            try {
                console.debug(JSON.stringify(newData, null, 2));
                const { status, data } = await userProfileApi.update(newData, userData._id);
                console.debug(status);
            } catch (error) {
                if (error.response?.data.errorMessage) {
                    console.error(error.response.data.errorMessage);
                } else {
                    console.error(error);
                }
            }
        }
    });
})();
