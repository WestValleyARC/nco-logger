import { EndPointClient, getIconSvg } from '#@client/lib/clientUtils.js';
import { createLogger } from '#@client/lib/logger.js';
import { isSystemNotificationResponse } from '#@client/types/commonTypesupport.js';
const logger = createLogger('lib/systemNotifications.ts');
export class SystemNotificationManager {
    static DISMISSED_KEY = 'dismissedNotifications';
    apiClient;
    modalElement = null;
    constructor() {
        this.apiClient = new EndPointClient('/api/util/notifications');
    }
    async checkAndDisplayNotifications() {
        try {
            const response = await this.apiClient.id('pending').show();
            if (!isSystemNotificationResponse(response)) {
                if (response.errorMessage) {
                    logger.debug('Error fetching notifications:', response.errorMessage);
                }
                else {
                    logger.error('Invalid notification response format');
                }
                return;
            }
            const { notifications, count } = response.message;
            if (count === 0 || notifications.length === 0) {
                logger.debug('No pending notifications');
                return;
            }
            const firstNotification = notifications[0];
            if (!firstNotification) {
                logger.error('First notification is undefined despite count > 0');
                return;
            }
            if (this.isAlreadyDismissedLocally(firstNotification.notificationId)) {
                logger.debug(`Notification ${firstNotification.notificationId} already dismissed locally`);
                return;
            }
            this.displayNotification(firstNotification);
        }
        catch (error) {
            logger.error('Failed to fetch notifications:', error);
        }
    }
    displayNotification(notification) {
        this.removeModal();
        const modal = this.createModalHTML(notification);
        document.body.appendChild(modal);
        this.modalElement = modal;
        const Bootstrap = window.bootstrap;
        const bsModal = new Bootstrap.Modal(modal, {
            backdrop: 'static',
            keyboard: false
        });
        const dismissBtns = modal.querySelectorAll('[data-dismiss-notification]');
        dismissBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                void this.dismissNotification(notification.notificationId).then(() => {
                    bsModal.hide();
                    setTimeout(() => this.removeModal(), 300);
                });
            });
        });
        bsModal.show();
    }
    createModalHTML(notification) {
        const severityIcon = this.getSeverityIcon(notification.severity);
        const severityBadge = this.getSeverityBadge(notification.severity);
        if (!document.getElementById('systemNotificationStyles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'systemNotificationStyles';
            styleEl.textContent = `
                #systemNotificationModal .btn-icon-close {
                    color: var(--hl-light, #f8f9fa);
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #systemNotificationModal .btn-icon-close svg {
                    width: 1.5em;
                    height: 1.5em;
                }
                #systemNotificationModal .btn-icon-close:hover {
                    opacity: 0.75;
                }
            `;
            document.head.appendChild(styleEl);
        }
        const modalHtml = `
            <div class="modal fade" id="systemNotificationModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1" aria-labelledby="systemNotificationModalLabel" aria-hidden="true" data-notification-id="${this.escapeHtml(notification.notificationId)}">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="systemNotificationModalLabel">
                                <i class="bi ${severityIcon} me-2"></i>${this.escapeHtml(notification.title)}
                                <span class="badge ${severityBadge} ms-2">${notification.severity.toUpperCase()}</span>
                            </h5>
                            <button type="button" class="btn-icon-close" aria-label="Close" data-dismiss-notification>${getIconSvg('bi-x-circle-fill')}</button>
                        </div>
                        <div class="modal-body">
                            ${notification.message}
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" data-dismiss-notification>
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        const div = document.createElement('div');
        div.innerHTML = modalHtml.trim();
        return div.firstElementChild;
    }
    async dismissNotification(notificationId) {
        try {
            await this.apiClient.id(`${notificationId}/dismiss`).create();
            this.markDismissedLocally(notificationId);
            logger.info(`Dismissed notification: ${notificationId}`);
        }
        catch (error) {
            logger.error('Failed to dismiss notification:', error);
            this.markDismissedLocally(notificationId);
        }
    }
    isAlreadyDismissedLocally(notificationId) {
        const dismissed = localStorage.getItem(SystemNotificationManager.DISMISSED_KEY);
        if (!dismissed)
            return false;
        try {
            const parsed = JSON.parse(dismissed);
            return Array.isArray(parsed) && parsed.every(value => typeof value === 'string') && parsed.includes(notificationId);
        }
        catch (error) {
            logger.error('Failed to parse dismissed notifications from localStorage:', error);
            return false;
        }
    }
    markDismissedLocally(notificationId) {
        try {
            const dismissed = localStorage.getItem(SystemNotificationManager.DISMISSED_KEY);
            const parsed = dismissed ? JSON.parse(dismissed) : [];
            const dismissedList = Array.isArray(parsed) && parsed.every(value => typeof value === 'string') ? parsed : [];
            if (!Array.isArray(dismissedList)) {
                localStorage.setItem(SystemNotificationManager.DISMISSED_KEY, JSON.stringify([notificationId]));
                return;
            }
            if (!dismissedList.includes(notificationId)) {
                dismissedList.push(notificationId);
                localStorage.setItem(SystemNotificationManager.DISMISSED_KEY, JSON.stringify(dismissedList));
            }
        }
        catch (error) {
            logger.error('Failed to save dismissed notification to localStorage:', error);
        }
    }
    removeModal() {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
        const backdrop = document.querySelector('.modal-backdrop');
        backdrop?.remove();
    }
    getSeverityIcon(severity) {
        switch (severity) {
            case 'critical':
                return 'bi-exclamation-triangle-fill';
            case 'warning':
                return 'bi-exclamation-circle-fill';
            case 'info':
            default:
                return 'bi-info-circle-fill';
        }
    }
    getSeverityBadge(severity) {
        switch (severity) {
            case 'critical':
                return 'bg-danger';
            case 'warning':
                return 'bg-primary';
            case 'info':
            default:
                return 'bg-secondary';
        }
    }
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
//# sourceMappingURL=systemNotifications.js.map