/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

tinymce.init({
    selector: 'textarea#input_notes',
    skin_url: '/tinymce/skins/hl',
    content_css: 'dark',
    plugins: 'lists',
    toolbar: 'bullist italic',
    menubar: '',
    promotion: false,
    statusbar: false,
    max_height: 235
});

import { HttpClient, FormState } from '#@client/lib/old__clientUtils.js';

const netProfileFormState = new FormState('netprofile', 'new');
const netOwnerFormState = new FormState('netowner', 'new');
const netProfileApi = new HttpClient('netprofile', '/api/data/netprofiles');

//Once we moved to es6 module imports, functions defined in modules are in their own namespace. In order to be accessible by
//things like onClick(), the functions needed to be exposed to 'window':
window.netProfileFormState = netProfileFormState;
window.netOwnerFormState = netOwnerFormState;
//That said, I really should do away with the onClick() stuff and write event handlers for this
//See: https://stackoverflow.com/questions/44590393/es6-modules-undefined-onclick-function-after-import
//
// Brief desc of:
// netListColumn-->netListContainer-->netListUL
//
// The Column is hidden/unhidden based on if there
// is actual netlist data returned from the server
//
// The Container simply is the parent of the netListUL
//
// The UL is made every time the list is retreived

window.formShow = function (id) {
    const netProfileDivElem = document.getElementById('formContainerNetProfile');
    const netOwnerDivElem = document.getElementById('formContainerNetOwner');

    if (id === 'formContainerNetProfile') {
        netProfileDivElem.classList.remove('d-none');
        netOwnerDivElem.classList.add('d-none');
    } else if (id === 'formContainerNetOwner') {
        netOwnerDivElem.classList.remove('d-none');
        netProfileDivElem.classList.add('d-none');
    } else {
        console.error('formShow function received unknown form id');
    }
};

window.modeHandler = function () {
    const mode = document.getElementById('input_mode').value;
    const modeDetailsInputElem = document.getElementById('input_modedetails');
    const isNewMode = netProfileFormState.mode === 'new';

    modeDetailsInputElem.required = mode === 'CUSTOM';

    if (isNewMode && (mode === 'CUSTOM' || mode === 'Reflector')) {
        const message =
            mode === 'CUSTOM'
                ? 'use mode details field to specify mode name'
                : 'use mode details field to specify reflector name';
        netProfileFormState.mesg('info', message);
    }
};

function refreshNetList() {
    const netListContainerElem = document.getElementById('netListContainer');
    const netCountElem = document.getElementById('net-count');
    const modalCollectionElem = document.getElementById('modal-collection');
    const modalTemplateElem = document.getElementById('modal-template');

    netListContainerElem.setAttribute('aria-busy', 'true');
    netListContainerElem.replaceChildren();
    document.querySelectorAll('.net-start-modal').forEach(modal => modal.remove());

    netProfileApi
        .index()
        .then(netProfiles => {
            console.table(netProfiles.data);

            if (!Array.isArray(netProfiles.data.netlist)) throw new Error('expected netlist to be an array');

            const ownedNets = netProfiles.data.netlist.filter(Boolean);
            netCountElem.textContent = ownedNets.length;
            netCountElem.setAttribute('aria-label', `${ownedNets.length} owned net${ownedNets.length === 1 ? '' : 's'}`);
            netListContainerElem.setAttribute('aria-busy', 'false');

            if (ownedNets.length === 0) {
                const emptyStateElem = document.createElement('div');
                emptyStateElem.setAttribute('class', 'owned-nets-empty');
                emptyStateElem.innerHTML =
                    '<i class="bi bi-broadcast" aria-hidden="true"></i><strong>No net profiles yet</strong><span>Create your first profile using the form.</span>';
                netListContainerElem.appendChild(emptyStateElem);
                return;
            }

            const netListUlElem = document.createElement('ul');
            netListUlElem.setAttribute('id', 'netList');
            netListUlElem.setAttribute('class', 'owned-net-list');

            ownedNets.forEach(netProfile => {
                const liElem = document.createElement('li');
                liElem.setAttribute('class', `owned-net-card${netProfile.liveNet ? ' is-live' : ''}`);

                const cardHeadingElem = document.createElement('div');
                cardHeadingElem.setAttribute('class', 'owned-net-heading');

                const titleGroupElem = document.createElement('div');
                titleGroupElem.setAttribute('class', 'owned-net-title-group');

                const titleElem = document.createElement('strong');
                titleElem.setAttribute('class', 'owned-net-title');
                titleElem.textContent = netProfile.title;

                const statusElem = document.createElement('span');
                statusElem.setAttribute('class', `owned-net-status${netProfile.liveNet ? ' is-live' : ''}`);
                statusElem.textContent = netProfile.liveNet ? 'Live now' : 'Ready';

                titleGroupElem.append(titleElem, statusElem);
                cardHeadingElem.appendChild(titleGroupElem);

                const buttonStartElem = document.createElement('button');
                buttonStartElem.type = 'button';
                buttonStartElem.setAttribute(
                    'class',
                    `owned-net-start${netProfile.liveNet ? ' is-live' : ''}`
                );

                if (!netProfile.liveNet) {
                    buttonStartElem.setAttribute('data-bs-toggle', 'modal');
                    buttonStartElem.setAttribute('data-bs-target', `#modal-${netProfile._id}`);
                    buttonStartElem.setAttribute('aria-label', `Start ${netProfile.title}`);
                } else {
                    buttonStartElem.setAttribute('aria-label', `Open live net ${netProfile.title}`);
                    buttonStartElem.addEventListener('click', () => {
                        window.location.href = `/views/livenet/${netProfile._id}`;
                    });
                }

                const iconElem = document.createElement('i');
                iconElem.setAttribute('class', `bi ${netProfile.liveNet ? 'bi-box-arrow-up-right' : 'bi-broadcast'}`);
                iconElem.setAttribute('aria-hidden', 'true');
                buttonStartElem.appendChild(iconElem);
                cardHeadingElem.appendChild(buttonStartElem);

                const operatingDetailsElem = document.createElement('div');
                operatingDetailsElem.setAttribute('class', 'owned-net-details');
                const frequency = netProfile.frequency && parseInt(netProfile.frequency) !== 0 ? netProfile.frequency : '';
                const mode = netProfile.mode === 'Reflector' || netProfile.mode === 'CUSTOM'
                    ? netProfile.modeDetails
                    : netProfile.mode;
                operatingDetailsElem.textContent = [frequency, mode].filter(Boolean).join(' · ') || 'Operating details not set';

                const actionsElem = document.createElement('div');
                actionsElem.setAttribute('class', 'owned-net-actions');

                const makeActionButton = ({ label, icon, action, danger = false }) => {
                    const buttonElem = document.createElement('button');
                    buttonElem.type = 'button';
                    buttonElem.setAttribute('class', `owned-net-action${danger ? ' is-danger' : ''}`);
                    buttonElem.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i><span>${label}</span>`;
                    buttonElem.addEventListener('click', action);
                    return buttonElem;
                };

                actionsElem.appendChild(
                    makeActionButton({
                        label: 'Edit',
                        icon: 'bi-pencil',
                        action: () => {
                            netProfileEditByID(netProfile._id);
                            formShow('formContainerNetProfile');
                        }
                    })
                );

                if (!netProfile.liveNet) {
                    actionsElem.appendChild(
                        makeActionButton({
                            label: 'Delete',
                            icon: 'bi-trash',
                            danger: true,
                            action: () => {
                                netProfileDelByID(netProfile._id);
                                formShow('formContainerNetProfile');
                            }
                        })
                    );
                }

                actionsElem.appendChild(
                    makeActionButton({
                        label: 'Co-owner',
                        icon: 'bi-person-plus',
                        action: () => {
                            netOwnerFormPrep(netProfile._id, netProfile.title);
                            formShow('formContainerNetOwner');
                        }
                    })
                );

                liElem.append(cardHeadingElem, operatingDetailsElem, actionsElem);
                netListUlElem.appendChild(liElem);

                if (!netProfile.liveNet) {
                    const modalClone = modalTemplateElem.cloneNode(true);
                    modalClone.id = `modal-${netProfile._id}`;
                    modalClone.classList.add('net-start-modal');
                    const modalLabelElem = modalClone.querySelector('#modalNetStart');
                    modalLabelElem.id = `modalNetStart-${netProfile._id}`;
                    modalLabelElem.innerText = `Start ${netProfile.title}`;
                    modalClone.setAttribute('aria-labelledby', modalLabelElem.id);

                    const countdownInputElem = modalClone.querySelector('#input_countdown-timer');
                    const countdownLabelElem = modalClone.querySelector('label[for="input_countdown-timer"]');
                    countdownInputElem.id = `input_countdown-timer-${netProfile._id}`;
                    countdownLabelElem.htmlFor = countdownInputElem.id;

                    const netStartFormElem = modalClone.querySelector('#netstart_form');
                    const netStartFormOutputElem = modalClone.querySelector('#netstart_form_output');
                    netStartFormElem.id = `netstart_form-${netProfile._id}`;
                    netStartFormOutputElem.id = `netstart_form_output-${netProfile._id}`;

                    netStartFormElem.addEventListener('submit', e => {
                        e.preventDefault();

                        const formDataToSend = new FormData(netStartFormElem);
                        const liveNetApi = new HttpClient('livenet', `/api/data/livenets/${netProfile._id}`);

                        liveNetApi
                            .create({ countdownTimer: formDataToSend.get('countdown-timer') })
                            .then(req => {
                                console.debug('livenet controller response', req);
                                window.location.replace(req.data.url);
                            })
                            .catch(error => {
                                const errorMessage = error.response?.data?.errorMessage || String(error);
                                netStartFormOutputElem.setAttribute('class', 'text-danger');
                                netStartFormOutputElem.innerText = errorMessage;
                                console.error(errorMessage);
                            });
                    });

                    modalCollectionElem.appendChild(modalClone);
                }
            });

            netListContainerElem.appendChild(netListUlElem);
        })
        .catch(err => {
            netListContainerElem.setAttribute('aria-busy', 'false');
            netListContainerElem.innerHTML =
                '<div class="owned-nets-empty is-error"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><strong>Could not load net profiles</strong><span>Please refresh and try again.</span></div>';
            console.error(err);
        });
}

window.netOwnerFormPrep = function (id, name) {
    document.getElementById('netowner_form_title').innerText = `Additional Owner for ${name}`;
    document.getElementById('input_npid_for_netowner').value = id;
    netOwnerFormState.mesg('info', 'enter email address');
};

//called by netlist "edit" link
window.netProfileEditByID = async function (id) {
    const res = await netProfileApi.show(id);
    console.debug('Retreived record to edit: ', res.data);
    netProfileFormState.mode = 'edit';

    document.getElementById('input_title').value = res.data.title;
    document.getElementById('input_frequency').value = res.data.frequency;
    document.getElementById('input_mode').value = res.data.mode;
    document.getElementById('input_restricted_sigrep').checked = res.data?.restrictedSigReports ? true : false;
    document.getElementById('input_auto_in').checked = res.data?.autoIn ? true : false;
    document.getElementById('input_modedetails').value = res.data.modeDetails;
    tinymce.get('input_notes').setContent(res.data.notes);

    document.getElementById('input_npid_for_netprofile').value = res.data._id;
    modeHandler();
};

//called by netlist "delete" link
window.netProfileDelByID = async function (id) {
    const res = await netProfileApi.delete(id);
    console.debug(res.data);
    refreshNetList();
};

// main form handler (for POST and PATCH methods)
function np_submitHandler(e) {
    e.preventDefault();

    const formDataToSend = new FormData(document.getElementById('netprofile_form'));

    const id = document.getElementById('input_npid_for_netprofile').value;

    const dataPayload = {
        title: formDataToSend.get('title'),
        frequency: formDataToSend.get('frequency'),
        mode: formDataToSend.get('mode'),
        restrictedSigReports: formDataToSend.get('restricted_sigrep') ? true : false,
        autoIn: formDataToSend.get('auto_in') ? true : false,
        notes: tinymce.get('input_notes').getContent(),
        modeDetails: formDataToSend.get('modedetails')
    };

    if (netProfileFormState.mode === 'edit') {
        netProfileApi
            .update(dataPayload, id)
            .then(req => {
                console.debug('Update: ', req);
                refreshNetList();
                // reset form back to new
                netProfileFormState.mode = 'new';
            })
            .catch(error => {
                if (error.response.data.errorMessage) {
                    netProfileFormState.mesg('error', error.response.data.errorMessage);
                    console.error(error.response.data.errorMessage);
                } else {
                    netProfileFormState.mesg('error', error);
                    console.error(error);
                }

                setTimeout(() => {
                    netProfileFormState.mode = 'edit';
                }, 8500);
            });
    } else if (netProfileFormState.mode === 'new') {
        netProfileApi
            .create(dataPayload)
            .then(req => {
                console.debug('Create: ', req);
                refreshNetList();
                console.info('refreshNetList() just ran');
            })
            .catch(error => {
                if (error.response.data.errorMessage) {
                    netProfileFormState.mesg('error', error.response.data.errorMessage);
                    console.error(error.response.data.errorMessage);
                } else {
                    netProfileFormState.mesg('error', error);
                    console.error(error);
                }

                setTimeout(() => {
                    netProfileFormState.mode = 'new';
                }, 8500);
            });
    } else {
        console.error('No valid form mode for upload');
    }
}

function netowner_submitHandler(e) {
    e.preventDefault();

    const formDataToSend = new FormData(document.getElementById('netowner_form'));

    const id = formDataToSend.get('npid_for_netowner');

    const dataPayload = {
        email: formDataToSend.get('email')
    };

    axios
        .post(`/api/data/netprofiles/addnetowner/${id}`, dataPayload)
        .then(req => {
            console.debug('Adding Net Owner: ', req);
            netOwnerFormState.mesg('info', 'Success: User will see ownership of this net in their account also');
            setTimeout(() => {
                location.reload();
            }, 6500);
        })
        .catch(error => {
            if (error.response.data.errorMessage) {
                netOwnerFormState.mesg('error', error.response.data.errorMessage);
                console.error(error.response.data.errorMessage);
            } else {
                netOwnerFormState.mesg('error', error);
                console.error(error);
            }
        });
}

document.getElementById('netprofile_form').addEventListener('submit', np_submitHandler);
document.getElementById('netowner_form').addEventListener('submit', netowner_submitHandler);

//init
formShow('formContainerNetProfile');
refreshNetList();
netProfileFormState.mode = 'new';
netOwnerFormState.mode = 'new';

setTimeout(() => {
    if (netProfileFormState.mode === 'new') {
        tinymce
            .get('input_notes')
            .setContent(
                'Net Control should change this SAMPLE text to relevant info about the club/net. The contents here will be displayed to net attendees, momentarily, when the live net page loads<p>Echolink: XX#XX-L</p>\n<p><em>this is italicized</em></p>'
            );
    }
}, 2000);
