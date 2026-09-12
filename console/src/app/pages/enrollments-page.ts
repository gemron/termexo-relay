import { Component, computed, inject, signal } from '@angular/core';

import { ConsoleApiService } from '../core/console-api.service';
import { describeConsoleError } from '../core/console-error';
import { registerRelayConsoleTranslations } from '../core/console.i18n';
import type {
  EnrollmentStatus,
  EnrollmentView,
  NewEnrollment,
  UserView,
} from '../core/console.models';
import { ToastService } from '../core/toast.service';
import { ConfirmBlockComponent } from '../shared/confirm-block';
import { CopyButtonComponent } from '../shared/copy-button';
import { formatMoment, formatText } from '../shared/format';
import { buildNameDirectory, shortId } from '../shared/name-directory';
import { PageState, StateBlockComponent } from '../shared/state-block';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';
import { EnrollmentDrawerComponent } from './enrollment-drawer';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

const STATUS_LABEL_KEYS: Readonly<Record<EnrollmentStatus, string>> = {
  pending: 'console.enrollments.statusPending',
  used: 'console.enrollments.statusUsed',
  expired: 'console.enrollments.statusExpired',
  cancelled: 'console.enrollments.statusCancelled',
};

const STATUS_TONES: Readonly<Record<EnrollmentStatus, string>> = {
  pending: 'online',
  used: 'neutral',
  expired: 'warning',
  cancelled: 'neutral',
};

@Component({
  selector: 'console-enrollments-page',
  imports: [
    ConfirmBlockComponent,
    CopyButtonComponent,
    EnrollmentDrawerComponent,
    StateBlockComponent,
    TranslatePipe,
  ],
  template: `
    <header class="page-header">
      <div>
        <h1>{{ 'console.enrollments.title' | t }}</h1>
        <p>{{ 'console.enrollments.subtitle' | t }}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn" [disabled]="loading()" (click)="reload()">
          {{ 'console.common.refresh' | t }}
        </button>
        <button type="button" class="btn btn-primary" (click)="openDrawer()">
          {{ 'console.enrollments.issue' | t }}
        </button>
      </div>
    </header>

    @if (issuedCode(); as code) {
      <!-- The relay never stores the code in the clear, so this is the only chance to read it. -->
      <div class="code-reveal" role="status">
        <strong>{{ 'console.enrollments.codeTitle' | t }}</strong>
        <div class="code-value">
          <code>{{ code }}</code>
          <console-copy-button buttonClass="btn btn-primary" [value]="code" />
        </div>
        <small>{{ 'console.enrollments.codeHint' | t }}</small>
      </div>
    }

    @if (state() === 'ready') {
      <div class="card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ 'console.enrollments.status' | t }}</th>
                <th>{{ 'console.enrollments.kind' | t }}</th>
                <th>{{ 'console.enrollments.owner' | t }}</th>
                <th>{{ 'console.enrollments.note' | t }}</th>
                <th>{{ 'console.enrollments.createdBy' | t }}</th>
                <th>{{ 'console.enrollments.expiresAt' | t }}</th>
                <th>{{ 'console.enrollments.usedAt' | t }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (enrollment of enrollments(); track enrollment.id) {
                <tr>
                  <td>
                    <span class="status" [attr.data-tone]="tone(enrollment)">
                      {{ statusLabel(enrollment) | t }}
                    </span>
                  </td>
                  <td>{{ kindLabel(enrollment) }}</td>
                  <td>{{ text(enrollment.ownerUsername) }}</td>
                  <td>{{ text(enrollment.note) }}</td>
                  <td [title]="enrollment.createdBy">{{ issuer(enrollment) }}</td>
                  <td>{{ moment(enrollment.expiresAt) }}</td>
                  <td>{{ moment(enrollment.usedAt) }}</td>
                  <td>
                    <div class="cell-actions">
                      @if (enrollment.status === 'pending') {
                        <!-- Neutral here; the confirmation below carries the danger styling. -->
                        <button
                          type="button"
                          class="btn btn-link"
                          [disabled]="acting()"
                          (click)="cancelling.set(enrollment.id)"
                        >
                          {{ 'console.enrollments.cancel' | t }}
                        </button>
                      }
                    </div>
                  </td>
                </tr>
                @if (cancelling() === enrollment.id) {
                  <tr>
                    <td colspan="8">
                      <console-confirm
                        [message]="'console.enrollments.cancelConfirm' | t"
                        [confirmLabel]="'console.enrollments.cancelAction' | t"
                        [busy]="acting()"
                        (confirmed)="cancel(enrollment)"
                        (cancelled)="cancelling.set(null)"
                      />
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    } @else {
      <console-state-block
        [state]="state()"
        [error]="error()"
        [emptyTitle]="'console.enrollments.empty' | t"
        [emptyHelp]="'console.enrollments.emptyHelp' | t"
        [actionLabel]="'console.enrollments.issue' | t"
        (retry)="reload()"
        (action)="openDrawer()"
      />
    }

    @if (drawerOpen()) {
      <console-enrollment-drawer
        [users]="users()"
        [busy]="issuing()"
        [error]="formError()"
        (closed)="closeDrawer()"
        (submitted)="issue($event)"
      />
    }
  `,
})
export class EnrollmentsPageComponent {
  private readonly api = inject(ConsoleApiService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly text = formatText;

  protected readonly enrollments = signal<EnrollmentView[]>([]);
  protected readonly users = signal<UserView[]>([]);
  protected readonly loading = signal(true);
  protected readonly issuing = signal(false);
  protected readonly acting = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  protected readonly issuedCode = signal('');
  protected readonly cancelling = signal<string | null>(null);
  protected readonly drawerOpen = signal(false);

  protected readonly state = computed<PageState>(() => {
    if (this.loading()) return 'loading';
    if (this.error()) return 'error';
    return this.enrollments().length === 0 ? 'empty' : 'ready';
  });

  /** Who issued a code is stored as a user id; the operator knows them by their name. */
  private readonly issuers = computed(() => buildNameDirectory(this.users(), []));

  constructor() {
    void this.load();
  }

  protected reload(): void {
    void this.load();
  }

  protected moment(value: number | null): string {
    return formatMoment(value, this.i18n.locale());
  }

  protected statusLabel(enrollment: EnrollmentView): string {
    return STATUS_LABEL_KEYS[enrollment.status];
  }

  protected tone(enrollment: EnrollmentView): string {
    return STATUS_TONES[enrollment.status];
  }

  protected kindLabel(enrollment: EnrollmentView): string {
    return this.i18n.t(
      enrollment.kind === 'relay' ? 'console.devices.kindRelay' : 'console.devices.kindDesktop',
    );
  }

  /** A deleted account leaves its id behind; a short one still tells two issuers apart. */
  protected issuer(enrollment: EnrollmentView): string {
    return this.issuers().get(enrollment.createdBy) ?? shortId(enrollment.createdBy);
  }

  protected openDrawer(): void {
    this.formError.set('');
    this.drawerOpen.set(true);
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
    this.formError.set('');
  }

  protected async issue(request: NewEnrollment): Promise<void> {
    if (this.issuing()) {
      return;
    }
    this.issuing.set(true);
    this.formError.set('');
    // The previous code is gone the moment a new one is issued; leaving it would be misleading.
    this.issuedCode.set('');
    try {
      const created = await this.api.createEnrollment(request);
      this.issuedCode.set(created.code);
      // The code has to be read before anything else, so the drawer gets out of its way.
      this.drawerOpen.set(false);
      this.toasts.success(this.i18n.t('console.enrollments.created'));
      await this.load();
    } catch (error) {
      this.formError.set(
        this.i18n.t('console.common.actionFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.issuing.set(false);
    }
  }

  protected async cancel(enrollment: EnrollmentView): Promise<void> {
    if (this.acting()) {
      return;
    }
    this.acting.set(true);
    try {
      await this.api.cancelEnrollment(enrollment.id);
      this.cancelling.set(null);
      this.toasts.success(this.i18n.t('console.enrollments.cancelled'));
      await this.load();
    } catch (error) {
      this.toasts.error(
        this.i18n.t('console.common.actionFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.acting.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [enrollments, users] = await Promise.all([
        this.api.listEnrollments(),
        this.api.listUsers(),
      ]);
      this.enrollments.set(enrollments);
      this.users.set(users);
    } catch (error) {
      this.error.set(
        this.i18n.t('console.common.loadFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.loading.set(false);
    }
  }
}
