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
import { formatConnectionLines } from '#@client/lib/publicSchedule.js';

const netProfileFormState = new FormState('netprofile', 'new');
const netOwnerFormState = new FormState('netowner', 'new');
const netProfileApi = new HttpClient('netprofile', '/api/data/netprofiles');
const NET_TITLE_PATTERN = /^[\p{L}\p{N} @|_#*&/+\-().,':!]+$/u;
const CONNECTION_FIELDS = {
    FM: [
        { key: 'frequency', label: 'Frequency', required: true, placeholder: '146.940' },
        { key: 'tone', label: 'PL / CTCSS', placeholder: '162.2' }
    ],
    AllStarLink: [{ key: 'node', label: 'Node Number', required: true }],
    EchoLink: [{ key: 'callsign', label: 'Callsign / Node', required: true }],
    DMR: [
        { key: 'talkgroup', label: 'Talkgroup', required: true },
        { key: 'colorCode', label: 'Color Code' }
    ],
    'D-STAR': [
        { key: 'reflector', label: 'Reflector', required: true },
        { key: 'module', label: 'Module' }
    ],
    YSF: [{ key: 'room', label: 'Room / Reflector', required: true }],
    P25: [{ key: 'talkgroup', label: 'Talkgroup', required: true }],
    Other: [
        { key: 'label', label: 'Label', required: true },
        { key: 'value', label: 'Value', required: true }
    ]
};
let connectionRows = [];
let connectionsTouched = false;
let editingHadStructuredConnections = false;

const createConnectionField = (connection, field) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'app-field connection-field';
    wrapper.textContent = field.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control app-input';
    input.value = connection[field.key] || '';
    input.placeholder = field.placeholder || '';
    input.required = Boolean(field.required);
    input.maxLength = field.key === 'value' ? 200 : 100;
    input.addEventListener('input', () => {
        connection[field.key] = input.value;
        connectionsTouched = true;
    });
    wrapper.appendChild(input);
    return wrapper;
};

const renderConnections = () => {
    const container = document.getElementById('connections_container');
    container.replaceChildren();
    connectionRows.forEach((connection, index) => {
        const card = document.createElement('div');
        card.className = 'connection-card';
        const header = document.createElement('div');
        header.className = 'connection-card-header';
        const typeField = document.createElement('label');
        typeField.className = 'app-field connection-type-field';
        typeField.textContent = 'Connection Type';
        const select = document.createElement('select');
        select.className = 'form-select app-input app-select';
        Object.keys(CONNECTION_FIELDS).forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            select.appendChild(option);
        });
        select.value = connection.type;
        select.addEventListener('change', () => {
            connectionRows[index] = { type: select.value };
            connectionsTouched = true;
            renderConnections();
        });
        typeField.appendChild(select);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'connection-remove';
        remove.setAttribute('aria-label', `Remove ${connection.type} connection`);
        remove.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i><span>Remove</span>';
        remove.addEventListener('click', () => {
            connectionRows.splice(index, 1);
            connectionsTouched = true;
            renderConnections();
        });
        header.append(typeField, remove);
        const fields = document.createElement('div');
        fields.className = 'connection-fields';
        CONNECTION_FIELDS[connection.type].forEach(field => fields.appendChild(createConnectionField(connection, field)));
        card.append(header, fields);
        container.appendChild(card);
    });
    if (!connectionRows.length) {
        const empty = document.createElement('p');
        empty.className = 'connections-empty';
        empty.textContent = 'No structured connections added.';
        container.appendChild(empty);
    }
};

const resetConnections = () => {
    connectionRows = [];
    connectionsTouched = false;
    editingHadStructuredConnections = false;
    const legacyNotice = document.getElementById('legacy_connection_notice');
    legacyNotice.hidden = true;
    legacyNotice.textContent = '';
    renderConnections();
};

const formatViewerDateTime = value => new Intl.DateTimeFormat([], {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
}).format(new Date(value));

const scheduleEditor = {
    modal: document.getElementById('schedule-editor-modal'),
    form: document.getElementById('schedule_editor_form'),
    fields: document.getElementById('schedule_editor_fields'),
    status: document.getElementById('schedule_editor_status'),
    title: document.getElementById('schedule-editor-title'),
    profileId: document.getElementById('schedule_profile_id'),
    type: document.getElementById('schedule_type'),
    timezone: document.getElementById('schedule_timezone'),
    startDate: document.getElementById('schedule_start_date'),
    startTime: document.getElementById('schedule_start_time'),
    endDate: document.getElementById('schedule_end_date'),
    disable: document.getElementById('schedule_disable')
};
let currentSchedule = null;

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const localDateValue = date => {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const setScheduleStatus = (message = '', error = false) => {
    scheduleEditor.status.textContent = message;
    scheduleEditor.status.classList.toggle('is-error', error);
};

const setScheduleBusy = busy => {
    scheduleEditor.fields.disabled = busy;
    scheduleEditor.modal.setAttribute('aria-busy', String(busy));
};

const updateScheduleFields = () => {
    const type = scheduleEditor.type.value;
    document.querySelectorAll('[data-schedule-fields]').forEach(section => {
        section.hidden = section.dataset.scheduleFields !== type;
    });
    document.querySelectorAll('[data-recurring-field]').forEach(field => {
        field.hidden = type === 'oneTime';
    });
};

const populateScheduleForm = schedule => {
    scheduleEditor.form.reset();
    scheduleEditor.type.value = schedule?.type || 'oneTime';
    scheduleEditor.timezone.value = schedule?.timezone || browserTimezone();
    scheduleEditor.startDate.value = schedule?.startDate || localDateValue(new Date());
    scheduleEditor.startTime.value = schedule?.localStartTime || '19:00';
    scheduleEditor.endDate.value = schedule?.endDate || '';
    document.querySelectorAll('input[name="schedule_weekday"]').forEach(input => {
        input.checked = (schedule?.weekdays || []).includes(Number(input.value));
    });
    document.getElementById('schedule_monthly_ordinal').value = String(schedule?.monthlyOrdinal ?? 1);
    document.getElementById('schedule_monthly_weekday').value = String(schedule?.monthlyWeekday ?? 1);
    document.getElementById('schedule_monthly_day').value = String(schedule?.monthlyDay ?? 1);
    scheduleEditor.disable.hidden = !schedule?.enabled;
    updateScheduleFields();
};

const schedulePayload = () => {
    const type = scheduleEditor.type.value;
    const payload = {
        type,
        timezone: scheduleEditor.timezone.value.trim(),
        localStartTime: scheduleEditor.startTime.value,
        startDate: scheduleEditor.startDate.value,
        endDate: type === 'oneTime' ? null : scheduleEditor.endDate.value || null,
        enabled: true
    };
    if (type === 'weekly') {
        payload.weekdays = [...document.querySelectorAll('input[name="schedule_weekday"]:checked')]
            .map(input => Number(input.value));
        if (!payload.weekdays.length) throw new Error('Select at least one weekday');
    } else if (type === 'monthlyPosition') {
        payload.monthlyOrdinal = Number(document.getElementById('schedule_monthly_ordinal').value);
        payload.monthlyWeekday = Number(document.getElementById('schedule_monthly_weekday').value);
    } else if (type === 'monthlyDate') {
        payload.monthlyDay = Number(document.getElementById('schedule_monthly_day').value);
    }
    return payload;
};

const openScheduleEditor = async netProfile => {
    let scheduleLoaded = false;
    currentSchedule = null;
    scheduleEditor.profileId.value = netProfile._id;
    scheduleEditor.title.textContent = `Schedule ${netProfile.title}`;
    populateScheduleForm(null);
    setScheduleStatus('Loading schedule…');
    setScheduleBusy(true);
    bootstrap.Modal.getOrCreateInstance(scheduleEditor.modal).show();
    try {
        const response = await axios.get(`/api/data/netprofiles/${netProfile._id}/schedule`);
        currentSchedule = response.data.schedule;
        populateScheduleForm(currentSchedule);
        scheduleLoaded = true;
        setScheduleStatus(currentSchedule.enabled
            ? 'Edit the active schedule.'
            : 'This schedule is disabled. Saving will enable it.');
    } catch (error) {
        if (error.response?.status === 404) {
            populateScheduleForm(null);
            scheduleLoaded = true;
            setScheduleStatus('Create a schedule for this net.');
        } else {
            setScheduleStatus(error.response?.data?.errorMessage || 'Could not load this schedule.', true);
        }
    } finally {
        setScheduleBusy(!scheduleLoaded);
    }
};

const closeScheduleEditor = () => {
    bootstrap.Modal.getOrCreateInstance(scheduleEditor.modal).hide();
    refreshNetList();
};

function setNetProfileMode(mode) {
    netProfileFormState.mode = mode;
    if (mode === 'new') netProfileFormState.mesg('info', 'Create new net profile');
}
window.setNetProfileMode = setNetProfileMode;

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
                const scheduling = netProfile.scheduling || {};
                const isLive = scheduling.onAir === true;
                const isPreparing = scheduling.preparing === true;
                const hasOperationalSession = isLive || isPreparing;
                const hasSchedule = scheduling.enabled === true;
                const liElem = document.createElement('li');
                liElem.setAttribute('class', `owned-net-card${isLive ? ' is-live' : ''}${isPreparing ? ' is-preparing' : ''}`);

                const cardHeadingElem = document.createElement('div');
                cardHeadingElem.setAttribute('class', 'owned-net-heading');

                const titleGroupElem = document.createElement('div');
                titleGroupElem.setAttribute('class', 'owned-net-title-group');

                const titleElem = document.createElement('strong');
                titleElem.setAttribute('class', 'owned-net-title');
                titleElem.textContent = netProfile.title;

                const statusElem = document.createElement('span');
                statusElem.setAttribute('class', `owned-net-status${isLive ? ' is-live' : ''}${isPreparing ? ' is-preparing' : ''}`);
                statusElem.textContent = isLive
                    ? 'ON AIR'
                    : isPreparing
                      ? 'Preparing'
                      : scheduling.canPrepare
                        ? 'Ready to Prepare'
                        : hasSchedule
                          ? 'Scheduled'
                          : 'Ready';

                titleGroupElem.append(titleElem, statusElem);
                cardHeadingElem.appendChild(titleGroupElem);

                const buttonStartElem = document.createElement('button');
                buttonStartElem.type = 'button';
                buttonStartElem.setAttribute(
                    'class',
                    `owned-net-start${isLive ? ' is-live' : ''}${isPreparing ? ' is-preparing' : ''}`
                );

                if (hasOperationalSession) {
                    buttonStartElem.setAttribute('aria-label', `${isLive ? 'Open live net' : 'Open prepared net'} ${netProfile.title}`);
                    buttonStartElem.title = isLive ? 'Open live net' : 'Open prepared net';
                    buttonStartElem.addEventListener('click', () => {
                        window.location.href = scheduling.actionUrl || `/views/livenet/${netProfile._id}`;
                    });
                } else if (hasSchedule && scheduling.canPrepare && scheduling.nextOccurrence) {
                    buttonStartElem.setAttribute('aria-label', `Prepare ${netProfile.title}`);
                    buttonStartElem.title = 'Prepare scheduled net';
                    buttonStartElem.addEventListener('click', async () => {
                        buttonStartElem.disabled = true;
                        try {
                            const response = await axios.post(
                                `/api/data/netprofiles/${netProfile._id}/occurrences/${scheduling.nextOccurrence.id}/prepare`
                            );
                            window.location.href = response.data.liveNet.url;
                        } catch (error) {
                            buttonStartElem.disabled = false;
                            console.error(error.response?.data?.errorMessage || String(error));
                        }
                    });
                } else if (hasSchedule) {
                    buttonStartElem.disabled = true;
                    buttonStartElem.title = scheduling.nextOccurrence ? 'Preparation window has not opened' : 'No upcoming occurrence';
                    buttonStartElem.setAttribute('aria-label', scheduling.nextOccurrence
                        ? `Preparation for ${netProfile.title} is not yet available`
                        : `${netProfile.title} has no upcoming occurrence`);
                } else {
                    buttonStartElem.setAttribute('data-bs-toggle', 'modal');
                    buttonStartElem.setAttribute('data-bs-target', `#modal-${netProfile._id}`);
                    buttonStartElem.setAttribute('aria-label', `Start ${netProfile.title}`);
                }

                const iconElem = document.createElement('i');
                iconElem.setAttribute('class', `bi ${hasOperationalSession ? 'bi-box-arrow-up-right' : hasSchedule ? 'bi-calendar-event' : 'bi-broadcast'}`);
                iconElem.setAttribute('aria-hidden', 'true');
                buttonStartElem.appendChild(iconElem);
                cardHeadingElem.appendChild(buttonStartElem);

                const operatingDetailsElem = document.createElement('div');
                operatingDetailsElem.setAttribute('class', 'owned-net-details');
                const connectionLines = formatConnectionLines(netProfile);
                if (connectionLines.length) {
                    connectionLines.forEach(line => {
                        const connectionElem = document.createElement('span');
                        connectionElem.textContent = line;
                        operatingDetailsElem.appendChild(connectionElem);
                    });
                } else {
                    operatingDetailsElem.textContent = 'Operating details not set';
                }

                const scheduleDetailsElem = document.createElement('div');
                scheduleDetailsElem.setAttribute('class', 'owned-net-schedule');
                if (hasSchedule) {
                    const recurrenceElem = document.createElement('span');
                    recurrenceElem.innerHTML = `<strong>Schedule</strong>${scheduling.summary}`;
                    scheduleDetailsElem.appendChild(recurrenceElem);
                    if (scheduling.nextOccurrence) {
                        const nextElem = document.createElement('span');
                        nextElem.innerHTML = `<strong>Next Net</strong>${formatViewerDateTime(scheduling.nextOccurrence.startAt)}`;
                        scheduleDetailsElem.appendChild(nextElem);
                    } else {
                        const nextElem = document.createElement('span');
                        nextElem.innerHTML = '<strong>Next Net</strong>No upcoming occurrence';
                        scheduleDetailsElem.appendChild(nextElem);
                    }
                    const timezoneElem = document.createElement('small');
                    timezoneElem.textContent = scheduling.timezone;
                    scheduleDetailsElem.appendChild(timezoneElem);
                }

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
                        label: 'Schedule',
                        icon: 'bi-calendar3',
                        action: () => openScheduleEditor(netProfile)
                    })
                );

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

                if (!hasOperationalSession) {
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

                liElem.append(cardHeadingElem, operatingDetailsElem);
                if (hasSchedule) liElem.appendChild(scheduleDetailsElem);
                liElem.appendChild(actionsElem);
                netListUlElem.appendChild(liElem);

                if (!hasSchedule && !hasOperationalSession) {
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
    document.getElementById('input_auto_in').checked = res.data?.autoIn ? true : false;
    tinymce.get('input_notes').setContent(res.data.notes);

    connectionRows = Array.isArray(res.data.connections)
        ? res.data.connections.map(({ _id, ...connection }) => ({ ...connection }))
        : [];
    editingHadStructuredConnections = connectionRows.length > 0;
    connectionsTouched = false;
    const legacyNotice = document.getElementById('legacy_connection_notice');
    const hasLegacyConnection = !editingHadStructuredConnections && res.data.mode === 'Reflector' && res.data.modeDetails;
    legacyNotice.hidden = !hasLegacyConnection;
    legacyNotice.textContent = hasLegacyConnection
        ? `Existing legacy connection: ${res.data.modeDetails}. Add a structured connection to replace it.`
        : '';
    renderConnections();

    document.getElementById('input_npid_for_netprofile').value = res.data._id;
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
    const title = String(formDataToSend.get('title') || '').trim();
    if (!NET_TITLE_PATTERN.test(title)) {
        netProfileFormState.mesg('error', 'Net name contains unsupported characters');
        return;
    }

    const dataPayload = {
        title,
        autoIn: formDataToSend.get('auto_in') ? true : false,
        notes: tinymce.get('input_notes').getContent()
    };
    if (netProfileFormState.mode === 'new' || editingHadStructuredConnections || connectionsTouched) {
        dataPayload.connections = connectionRows.map(connection => ({ ...connection }));
    }

    if (netProfileFormState.mode === 'edit') {
        netProfileApi
            .update(dataPayload, id)
            .then(req => {
                console.debug('Update: ', req);
                refreshNetList();
                // reset form back to new
                setNetProfileMode('new');
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
                    setNetProfileMode('new');
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
document.getElementById('add_connection').addEventListener('click', () => {
    connectionRows.push({ type: 'FM' });
    connectionsTouched = true;
    renderConnections();
});
document.getElementById('netprofile_form').addEventListener('reset', () => setTimeout(resetConnections));
scheduleEditor.type.addEventListener('change', updateScheduleFields);
scheduleEditor.form.addEventListener('submit', async event => {
    event.preventDefault();
    setScheduleBusy(true);
    setScheduleStatus('Saving schedule…');
    const id = scheduleEditor.profileId.value;
    try {
        const payload = schedulePayload();
        if (currentSchedule) {
            await axios.patch(`/api/data/netprofiles/${id}/schedule`, payload);
        } else {
            await axios.post(`/api/data/netprofiles/${id}/schedule`, payload);
        }
        closeScheduleEditor();
    } catch (error) {
        setScheduleStatus(error.response?.data?.errorMessage || error.message || 'Could not save schedule.', true);
    } finally {
        setScheduleBusy(false);
    }
});
scheduleEditor.disable.addEventListener('click', async () => {
    if (!currentSchedule || !window.confirm('Disable this schedule and cancel its future scheduled occurrences?')) return;
    setScheduleBusy(true);
    setScheduleStatus('Disabling schedule…');
    try {
        await axios.delete(`/api/data/netprofiles/${scheduleEditor.profileId.value}/schedule`);
        closeScheduleEditor();
    } catch (error) {
        setScheduleStatus(error.response?.data?.errorMessage || 'Could not disable schedule.', true);
    } finally {
        setScheduleBusy(false);
    }
});

const timezoneList = document.getElementById('schedule_timezones');
if (typeof Intl.supportedValuesOf === 'function') {
    Intl.supportedValuesOf('timeZone').forEach(timezone => {
        const option = document.createElement('option');
        option.value = timezone;
        timezoneList.appendChild(option);
    });
}

//init
formShow('formContainerNetProfile');
refreshNetList();
setNetProfileMode('new');
netOwnerFormState.mode = 'new';
resetConnections();

setTimeout(() => {
    if (netProfileFormState.mode === 'new') {
        tinymce
            .get('input_notes')
            .setContent(
                'Net Control should change this SAMPLE text to relevant info about the club/net. The contents here will be displayed to net attendees, momentarily, when the live net page loads<p>Echolink: XX#XX-L</p>\n<p><em>this is italicized</em></p>'
            );
    }
}, 2000);
