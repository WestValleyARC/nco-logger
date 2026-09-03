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
        { key: 'operation', label: 'Operation', options: ['Repeater', 'Simplex'] },
        { key: 'offset', label: 'Offset', placeholder: '-0.600', when: connection => connection.operation === 'Repeater' },
        { key: 'tone', label: 'PL / CTCSS', placeholder: '162.2' }
    ],
    HF: [
        { key: 'frequency', label: 'Frequency', required: true, placeholder: '7.268' },
        { key: 'mode', label: 'Mode', options: ['SSB', 'USB', 'LSB', 'CW', 'AM', 'Digital', 'Other'] }
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
    M17: [
        { key: 'reflector', label: 'Reflector', required: true },
        { key: 'module', label: 'Module' }
    ],
    NXDN: [{ key: 'talkgroup', label: 'Talkgroup', required: true }],
    Zello: [{ key: 'channel', label: 'Channel', required: true }],
    Other: [
        { key: 'label', label: 'Label', required: true },
        { key: 'value', label: 'Value', required: true }
    ]
};
let connectionRows = [];
let connectionsTouched = false;
let editingHadStructuredConnections = false;
let draggedConnectionCard = null;
let currentCoOwnerProfileId = null;

const moveConnection = (index, direction) => {
    const destination = index + direction;
    if (destination < 0 || destination >= connectionRows.length) return;
    const [connection] = connectionRows.splice(index, 1);
    connectionRows.splice(destination, 0, connection);
    connectionsTouched = true;
    renderConnections();
    requestAnimationFrame(() => {
        document.querySelector(`[data-connection-index="${destination}"] .connection-drag-handle`)?.focus();
    });
};

const commitDraggedConnectionOrder = container => {
    if (!draggedConnectionCard) return;
    const currentRows = connectionRows;
    const indexes = Array.from(container.querySelectorAll('.connection-card'))
        .map(card => Number.parseInt(card.dataset.connectionIndex, 10));
    if (indexes.length === currentRows.length && indexes.every(Number.isInteger)) {
        const orderChanged = indexes.some((value, index) => value !== index);
        if (orderChanged) {
            connectionRows = indexes.map(index => currentRows[index]);
            connectionsTouched = true;
        }
    }
    draggedConnectionCard = null;
    renderConnections();
};

const createConnectionField = (connection, field) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'app-field connection-field';
    wrapper.textContent = field.label;
    const input = document.createElement(field.options ? 'select' : 'input');
    if (!field.options) input.type = 'text';
    input.className = 'form-control app-input';
    if (field.options) {
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = 'Not specified';
        input.appendChild(blank);
        field.options.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            input.appendChild(option);
        });
    } else {
        input.placeholder = field.placeholder || '';
    }
    input.value = connection[field.key] || '';
    input.required = Boolean(field.required);
    input.maxLength = field.key === 'value' ? 200 : 100;
    input.addEventListener(field.options ? 'change' : 'input', () => {
        if (input.value) connection[field.key] = input.value;
        else delete connection[field.key];
        if (field.key === 'operation' && input.value === 'Simplex') delete connection.offset;
        connectionsTouched = true;
        if (field.key === 'operation') renderConnections();
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
        card.dataset.connectionIndex = String(index);
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
            connectionRows[index] = select.value === 'FM'
                ? { type: 'FM', operation: 'Repeater' }
                : { type: select.value };
            connectionsTouched = true;
            renderConnections();
        });
        typeField.appendChild(select);

        const cardActions = document.createElement('div');
        cardActions.className = 'connection-card-actions';
        const dragHandle = document.createElement('button');
        dragHandle.type = 'button';
        dragHandle.className = 'connection-drag-handle';
        dragHandle.draggable = true;
        dragHandle.title = 'Drag to reorder';
        dragHandle.setAttribute('aria-label', `Drag ${connection.type} connection to reorder`);
        dragHandle.innerHTML = '<i class="bi bi-grip-vertical" aria-hidden="true"></i>';
        dragHandle.addEventListener('dragstart', event => {
            draggedConnectionCard = card;
            card.classList.add('is-dragging');
            event.dataTransfer?.setData('text/plain', String(index));
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setDragImage(card, 20, 20);
            }
        });
        dragHandle.addEventListener('dragend', () => commitDraggedConnectionOrder(container));

        const moveUp = document.createElement('button');
        moveUp.type = 'button';
        moveUp.className = 'connection-order-button';
        moveUp.disabled = index === 0;
        moveUp.title = 'Move Up';
        moveUp.setAttribute('aria-label', `Move ${connection.type} connection up`);
        moveUp.innerHTML = '<i class="bi bi-arrow-up" aria-hidden="true"></i>';
        moveUp.addEventListener('click', () => moveConnection(index, -1));

        const moveDown = document.createElement('button');
        moveDown.type = 'button';
        moveDown.className = 'connection-order-button';
        moveDown.disabled = index === connectionRows.length - 1;
        moveDown.title = 'Move Down';
        moveDown.setAttribute('aria-label', `Move ${connection.type} connection down`);
        moveDown.innerHTML = '<i class="bi bi-arrow-down" aria-hidden="true"></i>';
        moveDown.addEventListener('click', () => moveConnection(index, 1));

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
        cardActions.append(dragHandle, moveUp, moveDown, remove);
        header.append(typeField, cardActions);
        const fields = document.createElement('div');
        fields.className = 'connection-fields';
        CONNECTION_FIELDS[connection.type].forEach(field => {
            if (!field.when || field.when(connection)) fields.appendChild(createConnectionField(connection, field));
        });
        card.append(header, fields);
        card.addEventListener('dragover', event => {
            if (!draggedConnectionCard || draggedConnectionCard === card) return;
            event.preventDefault();
            const bounds = card.getBoundingClientRect();
            if (event.clientY > bounds.top + bounds.height / 2) card.after(draggedConnectionCard);
            else card.before(draggedConnectionCard);
        });
        card.addEventListener('drop', event => {
            event.preventDefault();
            commitDraggedConnectionOrder(container);
        });
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
    endTime: document.getElementById('schedule_end_time'),
    endDate: document.getElementById('schedule_end_date'),
    disable: document.getElementById('schedule_disable'),
    occurrencesStatus: document.getElementById('schedule_occurrences_status'),
    occurrencesList: document.getElementById('schedule_occurrences_list')
};
let currentSchedule = null;
let preparationWindowTimer = null;
let preparationWindowTargets = [];

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const timeToMinutes = value => {
    if (!value) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
};

const durationFromTimes = (startTime, endTime) => {
    if (!endTime) return null;
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    let duration = end - start;
    if (duration <= 0) duration += 1440;
    return duration;
};

const endTimeFromDuration = (startTime, durationMinutes) => {
    if (!startTime || durationMinutes == null) return '';
    const total = (timeToMinutes(startTime) + durationMinutes) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
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
    scheduleEditor.endTime.value = endTimeFromDuration(
        scheduleEditor.startTime.value,
        schedule?.durationMinutes
    );
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
        durationMinutes: durationFromTimes(
            scheduleEditor.startTime.value,
            scheduleEditor.endTime.value
        ),
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

const occurrenceLocalValues = startAt => {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: currentSchedule.timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).formatToParts(new Date(startAt)).map(part => [part.type, part.value])
    );
    return { localDate: `${parts.year}-${parts.month}-${parts.day}`, localStartTime: `${parts.hour}:${parts.minute}` };
};

const setOccurrencesStatus = (message = '', error = false) => {
    scheduleEditor.occurrencesStatus.textContent = message;
    scheduleEditor.occurrencesStatus.classList.toggle('is-error', error);
};

const occurrenceStatusLabel = occurrence => ({
    scheduled: occurrence.isOverride ? 'Rescheduled' : 'Scheduled',
    preparing: 'Preparing',
    live: 'ON AIR',
    cancelled: 'Cancelled'
})[occurrence.status] || occurrence.status;

const loadOccurrences = async profileId => {
    scheduleEditor.occurrencesList.replaceChildren();
    setOccurrencesStatus('Loading…');
    const now = new Date();
    const query = new URLSearchParams({
        from: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        to: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        limit: '20'
    });
    try {
        const response = await axios.get(`/api/data/netprofiles/${profileId}/occurrences?${query}`);
        const occurrences = response.data.occurrences.filter(
            occurrence => ['scheduled', 'preparing', 'live', 'cancelled'].includes(occurrence.status)
        );
        setOccurrencesStatus(occurrences.length ? `${occurrences.length} shown` : '');
        if (!occurrences.length) {
            const empty = document.createElement('p');
            empty.className = 'schedule-occurrences-empty';
            empty.textContent = 'No upcoming occurrences are available yet.';
            scheduleEditor.occurrencesList.appendChild(empty);
            return;
        }

        occurrences.forEach(occurrence => {
            const item = document.createElement('article');
            item.className = `schedule-occurrence is-${occurrence.status}${occurrence.isOverride ? ' is-override' : ''}`;
            const summary = document.createElement('div');
            summary.className = 'schedule-occurrence-summary';
            const when = document.createElement('time');
            when.dateTime = occurrence.startAt;
            when.textContent = formatViewerDateTime(occurrence.startAt);
            const badge = document.createElement('span');
            badge.className = 'schedule-occurrence-status';
            badge.textContent = occurrenceStatusLabel(occurrence);
            summary.append(when, badge);
            item.appendChild(summary);

            const actions = document.createElement('div');
            actions.className = 'schedule-occurrence-actions';
            if (occurrence.status === 'scheduled') {
                const reschedule = document.createElement('button');
                reschedule.type = 'button';
                reschedule.className = 'owned-net-action';
                reschedule.textContent = 'Reschedule';
                const cancel = document.createElement('button');
                cancel.type = 'button';
                cancel.className = 'owned-net-action is-danger';
                cancel.textContent = 'Cancel';
                actions.append(reschedule, cancel);

                const editor = document.createElement('div');
                editor.className = 'schedule-occurrence-editor';
                editor.hidden = true;
                const values = occurrenceLocalValues(occurrence.startAt);
                const date = document.createElement('input');
                date.type = 'date';
                date.className = 'form-control app-input';
                date.value = values.localDate;
                date.setAttribute('aria-label', 'Occurrence date');
                const time = document.createElement('input');
                time.type = 'time';
                time.className = 'form-control app-input';
                time.value = values.localStartTime;
                time.setAttribute('aria-label', 'Occurrence time');
                const save = document.createElement('button');
                save.type = 'button';
                save.className = 'app-button app-button-secondary app-button-compact';
                save.textContent = 'Save';
                editor.append(date, time, save);
                item.appendChild(editor);

                reschedule.addEventListener('click', () => { editor.hidden = !editor.hidden; });
                save.addEventListener('click', async () => {
                    setOccurrencesStatus('Rescheduling…');
                    try {
                        await axios.patch(
                            `/api/data/netprofiles/${profileId}/occurrences/${occurrence._id}`,
                            { localDate: date.value, localStartTime: time.value }
                        );
                        await loadOccurrences(profileId);
                        refreshNetList();
                    } catch (error) {
                        setOccurrencesStatus(error.response?.data?.errorMessage || 'Could not reschedule occurrence.', true);
                    }
                });
                cancel.addEventListener('click', async () => {
                    if (!window.confirm('Cancel only this scheduled occurrence?')) return;
                    setOccurrencesStatus('Cancelling occurrence…');
                    try {
                        await axios.delete(`/api/data/netprofiles/${profileId}/occurrences/${occurrence._id}`);
                        await loadOccurrences(profileId);
                        refreshNetList();
                    } catch (error) {
                        setOccurrencesStatus(error.response?.data?.errorMessage || 'Could not cancel occurrence.', true);
                    }
                });
            } else if (occurrence.status === 'preparing') {
                const cancelPreparation = document.createElement('button');
                cancelPreparation.type = 'button';
                cancelPreparation.className = 'owned-net-action is-danger';
                cancelPreparation.textContent = 'Cancel Preparation';
                cancelPreparation.addEventListener('click', async () => {
                    if (!window.confirm('Cancel preparation and cancel this scheduled occurrence?')) return;
                    setOccurrencesStatus('Cancelling preparation…');
                    try {
                        await axios.post(
                            `/api/data/netprofiles/${profileId}/occurrences/${occurrence._id}/cancel-preparation`
                        );
                        await loadOccurrences(profileId);
                        refreshNetList();
                    } catch (error) {
                        setOccurrencesStatus(error.response?.data?.errorMessage || 'Could not cancel preparation.', true);
                    }
                });
                actions.appendChild(cancelPreparation);
            }
            if (actions.childElementCount) item.appendChild(actions);
            scheduleEditor.occurrencesList.appendChild(item);
        });
    } catch (error) {
        setOccurrencesStatus(error.response?.data?.errorMessage || 'Could not load upcoming occurrences.', true);
    }
};

const showNoOccurrences = message => {
    scheduleEditor.occurrencesList.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'schedule-occurrences-empty';
    empty.textContent = message;
    scheduleEditor.occurrencesList.appendChild(empty);
    setOccurrencesStatus('');
};

const openScheduleEditor = async netProfile => {
    let scheduleLoaded = false;
    currentSchedule = null;
    scheduleEditor.profileId.value = netProfile._id;
    scheduleEditor.title.textContent = `Schedule ${netProfile.title}`;
    populateScheduleForm(null);
    showNoOccurrences('Save a schedule to manage its upcoming occurrences.');
    setScheduleStatus('Loading schedule…');
    setScheduleBusy(true);
    bootstrap.Modal.getOrCreateInstance(scheduleEditor.modal).show();
    try {
        const response = await axios.get(`/api/data/netprofiles/${netProfile._id}/schedule`);
        currentSchedule = response.data.schedule;
        populateScheduleForm(currentSchedule);
        await loadOccurrences(netProfile._id);
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

const enablePreparationAction = ({ button, status, netProfile, scheduling }) => {
    scheduling.canPrepare = true;
    status.textContent = 'Ready to Prepare';
    button.disabled = false;
    button.title = 'Prepare scheduled net';
    button.setAttribute('aria-label', `Prepare ${netProfile.title}`);
    button.onclick = async () => {
        button.disabled = true;
        try {
            const response = await axios.post(
                `/api/data/netprofiles/${netProfile._id}/occurrences/${scheduling.nextOccurrence.id}/prepare`
            );
            window.location.href = response.data.liveNet.url;
        } catch (error) {
            button.disabled = false;
            console.error(error.response?.data?.errorMessage || String(error));
        }
    };
};

const schedulePreparationWindowUpdate = () => {
    clearTimeout(preparationWindowTimer);
    preparationWindowTimer = null;
    const now = Date.now();
    const pending = [];
    preparationWindowTargets.forEach(target => {
        if (now >= target.opensAt) {
            const graceEndsAt = Date.parse(target.scheduling.nextOccurrence.startAt) + 30 * 60 * 1000;
            if (now < graceEndsAt) enablePreparationAction(target);
        } else {
            pending.push(target);
        }
    });
    preparationWindowTargets = pending;
    if (!pending.length) return;
    const nextOpensAt = Math.min(...pending.map(target => target.opensAt));
    preparationWindowTimer = window.setTimeout(
        schedulePreparationWindowUpdate,
        Math.min(Math.max(nextOpensAt - now + 25, 25), 2147483647)
    );
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

    clearTimeout(preparationWindowTimer);
    preparationWindowTimer = null;
    preparationWindowTargets = [];

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
                    enablePreparationAction({
                        button: buttonStartElem, status: statusElem, netProfile, scheduling
                    });
                } else if (hasSchedule) {
                    buttonStartElem.disabled = true;
                    buttonStartElem.title = scheduling.nextOccurrence ? 'Preparation window has not opened' : 'No upcoming occurrence';
                    buttonStartElem.setAttribute('aria-label', scheduling.nextOccurrence
                        ? `Preparation for ${netProfile.title} is not yet available`
                        : `${netProfile.title} has no upcoming occurrence`);
                    const opensAt = Date.parse(scheduling.preparationOpensAt);
                    if (scheduling.nextOccurrence && Number.isFinite(opensAt)) {
                        preparationWindowTargets.push({
                            opensAt, button: buttonStartElem, status: statusElem, netProfile, scheduling
                        });
                    }
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

                if (netProfile.isPrimaryOwner) {
                    actionsElem.appendChild(
                        makeActionButton({
                            label: 'Co-Owners',
                            icon: 'bi-people',
                            action: () => {
                                netOwnerFormPrep(netProfile._id, netProfile.title);
                                formShow('formContainerNetOwner');
                            }
                        })
                    );
                }

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
            schedulePreparationWindowUpdate();
        })
        .catch(err => {
            netListContainerElem.setAttribute('aria-busy', 'false');
            netListContainerElem.innerHTML =
                '<div class="owned-nets-empty is-error"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><strong>Could not load net profiles</strong><span>Please refresh and try again.</span></div>';
            console.error(err);
        });
}

const renderCoOwners = coOwners => {
    const list = document.getElementById('coowner_list');
    list.replaceChildren();
    if (!coOwners.length) {
        const empty = document.createElement('p');
        empty.className = 'coowner-empty';
        empty.textContent = 'No co-owners have been added.';
        list.appendChild(empty);
        return;
    }
    coOwners.forEach(coOwner => {
        const row = document.createElement('div');
        row.className = 'coowner-row';
        const identity = document.createElement('span');
        const callsign = document.createElement('strong');
        callsign.textContent = coOwner.callSign;
        const name = document.createElement('small');
        name.textContent = coOwner.displayName || '';
        identity.append(callsign, name);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'owned-net-action is-danger';
        remove.innerHTML = '<i class="bi bi-person-dash" aria-hidden="true"></i><span>Remove Co-Owner</span>';
        remove.addEventListener('click', async () => {
            if (!window.confirm(`Remove ${coOwner.callSign} as a co-owner?`)) return;
            try {
                await axios.delete(`/api/data/netprofiles/${currentCoOwnerProfileId}/coowners/${coOwner.id}`);
                await loadCoOwners();
                refreshNetList();
            } catch (error) {
                netOwnerFormState.mesg('error', error.response?.data?.errorMessage || error.message);
            }
        });
        row.append(identity, remove);
        list.appendChild(row);
    });
};

const loadCoOwners = async () => {
    const response = await axios.get(`/api/data/netprofiles/${currentCoOwnerProfileId}/coowners`);
    renderCoOwners(response.data.coOwners || []);
};

window.netOwnerFormPrep = async function (id, name) {
    currentCoOwnerProfileId = id;
    document.getElementById('netowner_form_title').innerText = `Co-Owners for ${name}`;
    document.getElementById('input_npid_for_netowner').value = id;
    netOwnerFormState.mesg('info', 'Add a registered operator');
    try {
        await loadCoOwners();
    } catch (error) {
        netOwnerFormState.mesg('error', error.response?.data?.errorMessage || error.message);
    }
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
        identifier: formDataToSend.get('identifier')
    };

    axios
        .post(`/api/data/netprofiles/${id}/coowners`, dataPayload)
        .then(async req => {
            console.debug('Adding Net Owner: ', req);
            document.getElementById('input_coowner_identifier').value = '';
            netOwnerFormState.mesg('info', 'Co-owner added');
            await loadCoOwners();
            refreshNetList();
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
    connectionRows.push({ type: 'FM', operation: 'Repeater' });
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
