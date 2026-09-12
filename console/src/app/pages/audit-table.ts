import { Component, inject, input } from '@angular/core';

import type { AuditView } from '../core/console.models';
import {
  describeActor,
  describeTarget,
  type EntityRef,
  formatAuditAction,
  formatAuditDetail,
} from '../shared/audit-format';
import { formatMoment } from '../shared/format';
import { EMPTY_NAME_DIRECTORY, type NameDirectory } from '../shared/name-directory';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';

/**
 * The audit log, as a table.
 *
 * The overview shows the same rows as the audit page, only fewer columns of them, so both render
 * through this component: a change to how an action or an actor reads lands in both at once.
 */
@Component({
  selector: 'console-audit-table',
  imports: [TranslatePipe],
  template: `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>{{ 'console.audit.time' | t }}</th>
            @if (detailed()) {
              <th>{{ 'console.audit.actor' | t }}</th>
            }
            <th>{{ 'console.audit.action' | t }}</th>
            <th>{{ 'console.audit.target' | t }}</th>
            @if (detailed()) {
              <th>{{ 'console.audit.ip' | t }}</th>
              <th>{{ 'console.audit.detail' | t }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (event of events(); track event.id) {
            <tr>
              <td>{{ moment(event.at) }}</td>
              @if (detailed()) {
                <td>
                  @if (actor(event); as party) {
                    <span class="cell-entity" [title]="party.title">
                      <span class="cell-entity-name">{{ party.label }}</span>
                      @if (party.hint) {
                        <small>{{ party.hint }}</small>
                      }
                    </span>
                  }
                </td>
              }
              <td class="cell-name">{{ action(event) }}</td>
              <td>
                @if (target(event); as object) {
                  @if (object.label) {
                    <span class="cell-entity" [title]="object.title">
                      <span class="cell-entity-name">{{ object.label }}</span>
                      @if (object.hint) {
                        <small>{{ object.hint }}</small>
                      }
                    </span>
                  } @else {
                    {{ 'console.common.none' | t }}
                  }
                }
              </td>
              @if (detailed()) {
                <td class="cell-mono">{{ ip(event) }}</td>
                <td class="cell-detail" [title]="detail(event)">
                  {{ detail(event) || ('console.common.none' | t) }}
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AuditTableComponent {
  private readonly i18n = inject(I18nService);

  readonly events = input.required<AuditView[]>();
  /** The audit page adds the actor, the address and the detail; the overview shows neither. */
  readonly detailed = input(false);
  /** Identifier-to-name lookup; without one every party falls back to a short identifier. */
  readonly directory = input<NameDirectory>(EMPTY_NAME_DIRECTORY);

  protected moment(value: number): string {
    return formatMoment(value, this.i18n.locale());
  }

  protected action(event: AuditView): string {
    return formatAuditAction(event.action, this.translate);
  }

  protected actor(event: AuditView): EntityRef {
    return describeActor(event, this.directory(), this.translate);
  }

  protected target(event: AuditView): EntityRef {
    return describeTarget(event, this.directory(), this.translate);
  }

  protected detail(event: AuditView): string {
    return formatAuditDetail(event.detail, this.translate);
  }

  protected ip(event: AuditView): string {
    return event.ip ?? this.i18n.t('console.common.none');
  }

  private readonly translate = (
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ): string => this.i18n.t(key, params);
}
