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
    const netProfilecurrentClass = netProfileDivElem.getAttribute('class');

    const netOwnerDivElem = document.getElementById('formContainerNetOwner');
    const netOwnerCurrentClass = netOwnerDivElem.getAttribute('class');

    if (id === 'formContainerNetProfile') {
        netProfileDivElem.setAttribute('class', netProfilecurrentClass.replace(' d-none', ''));

        if (!netOwnerCurrentClass.includes('d-none')) {
            netOwnerDivElem.setAttribute('class', netOwnerCurrentClass + ' d-none');
        }
    } else if (id === 'formContainerNetOwner') {
        netOwnerDivElem.setAttribute('class', netOwnerCurrentClass.replace(' d-none', ''));

        if (!netProfilecurrentClass.includes('d-none')) {
            netProfileDivElem.setAttribute('class', netProfilecurrentClass + ' d-none');
        }
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
    //clear prior UL 'netList'
    !!document.getElementById('netList') && document.getElementById('netList').remove();

    // netListContainerElem is the parent of netListUlElem,
    // we create the UL each time and append to the div
    // container

    const netListContainerElem = document.getElementById('netListContainer');

    // get all netprofiles from server:
    netProfileApi
        .index()
        .then(netProfiles => {
            console.table(netProfiles.data);

            // create our UL from current netprofiles data
            const netListUlElem = document.createElement('ul');
            netListUlElem.setAttribute('id', 'netList');
            netListUlElem.setAttribute('class', 'list-unstyled');

            const netListColumnElem = document.getElementById('netListColumn');
            const currentClass = netListColumnElem.getAttribute('class');
            // use bootstrap to set display:none when there are no
            // items in the list (allowing form to move left)

            if (!Array.isArray(netProfiles.data.netlist)) throw new Error('expected netlist to be an array');

            if (netProfiles.data.netlist.length < 1) {
                netListColumnElem.setAttribute('class', currentClass + ' d-none');
            }
            if (netProfiles.data.netlist.length > 0) {
                netListColumnElem.setAttribute('class', currentClass.replace(' d-none', ''));
            }

            netProfiles.data.netlist.forEach(netProfile => {
                //For each net profile, construct a list item and create
                // a net start modal

                // BEGIN MODALS:
                const modalCollectionElem = document.getElementById('modal-collection');
                const modalTemplateElem = document.getElementById('modal-template');
                const modalClone = modalTemplateElem.cloneNode(true);
                modalClone.id = `modal-${netProfile._id}`;
                // Clone master modal template:
                const modalLabelElem = modalClone.querySelector('#modalNetStart');
                modalLabelElem.innerText = `${netProfile.title}: going LIVE!`;

                //Modal "Net Start" Form
                const netStartFormElem = modalClone.querySelector('#netstart_form');
                const netStartFormOutputElem = modalClone.querySelector('#netstart_form_output');
                netStartFormElem.setAttribute('id', `netstart_form-${netProfile._id}`);

                netStartFormElem.addEventListener('submit', e => {
                    e.preventDefault();

                    const formDataToSend = new FormData(netStartFormElem);
                    const liveNetApi = new HttpClient('livenet', `/api/data/livenets/${netProfile._id}`);

                    const dataPayload = {
                        countdownTimer: formDataToSend.get('countdown-timer')
                    };

                    liveNetApi
                        .create(dataPayload)
                        .then(req => {
                            console.debug('livenet controller response', req);

                            window.location.replace(req.data.url);
                        })
                        .catch(error => {
                            if (error.response.data.errorMessage) {
                                netStartFormOutputElem.setAttribute('class', 'text-danger');
                                netStartFormOutputElem.innerText = error.response.data.errorMessage;
                                console.error(error.response.data.errorMessage);
                            } else {
                                netStartFormOutputElem.setAttribute('class', 'text-danger');
                                netStartFormOutputElem.innerText = error;
                                console.error(error);
                            }
                        });
                });

                modalCollectionElem.appendChild(modalClone);

                // END MODALS

                // BEGIN LIST ITEM CONSTRUCTION
                const liElem = document.createElement('li');
                const buttonStartElem = document.createElement('button');
                const aEditElem = document.createElement('a');
                const aDeleteElem = document.createElement('a');
                const aNetOwnerElem = document.createElement('a');

                if (!netProfile.liveNet) {
                    buttonStartElem.setAttribute('class', 'btn btn-small btn-outline-secondary');
                    buttonStartElem.setAttribute('data-bs-toggle', 'modal');
                    buttonStartElem.setAttribute('data-bs-target', `#modal-${netProfile._id}`);
                } else {
                    buttonStartElem.setAttribute('class', 'btn btn-small btn-outline-danger');
                    buttonStartElem.setAttribute('onclick', `location.href='/views/livenet/${netProfile._id}';`);
                }

                const iconElem = document.createElement('i');
                iconElem.setAttribute('class', 'bi bi-power');
                buttonStartElem.appendChild(iconElem);
                liElem.appendChild(buttonStartElem);
                liElem.append(' ');
                liElem.append(netProfile.title);
                liElem.setAttribute('class', 'text-light');

                const smallElem = document.createElement('small');
                smallElem.setAttribute('class', 'text-muted');
                liElem.appendChild(smallElem);
                smallElem.append(' (');
                aEditElem.setAttribute('href', '#');
                aEditElem.setAttribute(
                    'onclick',
                    `netProfileEditByID('${netProfile._id}'); formShow('formContainerNetProfile'); return false;`
                );
                aEditElem.innerText = 'edit';
                smallElem.appendChild(aEditElem);
                smallElem.append(') ');

                if (!netProfile.liveNet) {
                    smallElem.append(' (');
                    aDeleteElem.setAttribute('href', '#');
                    aDeleteElem.setAttribute(
                        'onclick',
                        `netProfileDelByID('${netProfile._id}'); formShow('formContainerNetProfile'); return false;`
                    );
                    aDeleteElem.innerText = 'delete';
                    smallElem.appendChild(aDeleteElem);
                    smallElem.append(') ');
                }

                smallElem.append(' (');
                aNetOwnerElem.setAttribute('href', '#');
                aNetOwnerElem.setAttribute(
                    'onclick',
                    `netOwnerFormPrep('${netProfile._id}', "${netProfile.title}"); formShow('formContainerNetOwner'); return false;`
                );
                aNetOwnerElem.innerText = '+co-owner';
                smallElem.appendChild(aNetOwnerElem);
                smallElem.append(') ');

                // END LIST ITEM CONSTRUCTION
                netListUlElem.append(liElem);
                // add newly formed UL to container div
                netListContainerElem.append(netListUlElem);
            });
        })
        .catch(err => {
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
