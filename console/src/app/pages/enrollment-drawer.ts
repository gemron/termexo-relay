import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { DeviceKind, NewEnrollment, UserView } from '../core/console.models';
import { DrawerComponent } from '../shared/drawer';
import { TranslatePipe } from '../shared/workspace-ui';

export const DEFAULT_TTL_MINUTES = 15;
export const MIN_TTL_MINUTES = 1;
/** The relay's own ceiling: a code that outlives a day is a password with extra steps. */
export const MAX_TTL_MINUTES = 1440;

/**
 * The form that issues one enrolment code.
 *
 * It lives in a drawer rather than permanently on the page because issuing a code is an
 * occasional act, while reading the list of outstanding codes is the reason the page is open.
 */
@Component({
  selector: 'console-enrollment-drawer',
  imports: [DrawerComponent, FormsModule, TranslatePipe],
  template: `
    <console-drawer [heading]="'console.enrollments.issue' | t" (closed)="closed.emit()">
      @if (error()) {
        <div class="alert error" role="alert">{{ error() }}</div>
      }

      <form (ngSubmit)="submit()">
        <div class="field-row">
          <label class="field">
            <span>{{ 'console.enrollments.kind' | t }}</span>
            <select
              name="kind"
              [disabled]="busy()"
              [ngModel]="kind()"
              (ngModelChange)="kind.set($event)"
            >
              <option value="desktop">{{ 'console.devices.kindDesktop' | t }}</option>
              <option value="relay">{{ 'console.devices.kindRelay' | t }}</option>
            </select>
          </label>
          <label class="field">
            <span>{{ 'console.enrollments.owner' | t }}</span>
            <select
              name="owner"
              [disabled]="busy()"
              [ngModel]="ownerUserId()"
              (ngModelChange)="ownerUserId.set($event)"
            >
              <option value="">{{ 'console.enrollments.ownerNone' | t }}</option>
              @for (user of users(); track user.id) {
                <option [value]="user.id">{{ user.username }}</option>
              }
            </select>
          </label>
        </div>
        <div class="field-row">
          <label class="field">
            <span>{{ 'console.enrollments.ttl' | t }}</span>
            <input
              name="ttl"
              type="number"
              inputmode="numeric"
              [min]="minTtl"
              [max]="maxTtl"
              [disabled]="busy()"
              [attr.aria-invalid]="ttlInvalid() ? 'true' : null"
              [ngModel]="ttlMinutes()"
              (ngModelChange)="ttlMinutes.set($event)"
            />
            @if (ttlInvalid()) {
              <small class="field-error" role="alert">
                {{ 'console.enrollments.ttlInvalid' | t }}
              </small>
            } @else {
              <small>{{ 'console.enrollments.ttlHint' | t }}</small>
            }
          </label>
          <label class="field">
            <span>{{ 'console.enrollments.note' | t }}</span>
            <input
              name="note"
              type="text"
              [placeholder]="'console.enrollments.notePlaceholder' | t"
              [disabled]="busy()"
              [ngModel]="note()"
              (ngModelChange)="note.set($event)"
            />
          </label>
        </div>

        <div class="form-actions">
          <button type="button" class="btn" [disabled]="busy()" (click)="closed.emit()">
            {{ 'console.common.cancel' | t }}
          </button>
          <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">
            {{ (busy() ? 'console.enrollments.issuing' : 'console.enrollments.issue') | t }}
          </button>
        </div>
      </form>
    </console-drawer>
  `,
})
export class EnrollmentDrawerComponent {
  readonly users = input.required<UserView[]>();
  readonly busy = input(false);
  readonly error = input('');

  readonly closed = output<void>();
  readonly submitted = output<NewEnrollment>();

  protected readonly minTtl = MIN_TTL_MINUTES;
  protected readonly maxTtl = MAX_TTL_MINUTES;

  protected readonly kind = signal<DeviceKind>('desktop');
  protected readonly ownerUserId = signal('');
  protected readonly ttlMinutes = signal<number | null>(DEFAULT_TTL_MINUTES);
  protected readonly note = signal('');

  protected readonly ttlInvalid = computed(() => {
    const value = this.ttlMinutes();
    return (
      value === null ||
      !Number.isInteger(value) ||
      value < MIN_TTL_MINUTES ||
      value > MAX_TTL_MINUTES
    );
  });

  protected readonly canSubmit = computed(() => !this.busy() && !this.ttlInvalid());

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.submitted.emit(this.buildRequest());
  }

  private buildRequest(): NewEnrollment {
    const request: NewEnrollment = {
      kind: this.kind(),
      ttlMinutes: this.ttlMinutes() ?? DEFAULT_TTL_MINUTES,
    };
    if (this.ownerUserId()) {
      request.ownerUserId = this.ownerUserId();
    }
    const note = this.note().trim();
    if (note) {
      request.note = note;
    }
    return request;
  }
}
