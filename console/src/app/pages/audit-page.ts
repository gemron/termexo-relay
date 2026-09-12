import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConsoleApiService } from '../core/console-api.service';
import { describeConsoleError } from '../core/console-error';
import { registerRelayConsoleTranslations } from '../core/console.i18n';
import type { AuditView } from '../core/console.models';
import {
  buildNameDirectory,
  EMPTY_NAME_DIRECTORY,
  type NameDirectory,
} from '../shared/name-directory';
import { PageState, StateBlockComponent } from '../shared/state-block';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';
import { AuditTableComponent } from './audit-table';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

/** One screenful and then some; the page loads further batches on demand. */
const PAGE_SIZE = 100;

@Component({
  selector: 'console-audit-page',
  imports: [AuditTableComponent, FormsModule, StateBlockComponent, TranslatePipe],
  template: `
    <header class="page-header">
      <div>
        <h1>{{ 'console.audit.title' | t }}</h1>
        <p>{{ 'console.audit.subtitle' | t }}</p>
      </div>
      <div class="page-actions">
        <label class="field">
          <input
            name="target"
            type="search"
            [placeholder]="'console.audit.filterPlaceholder' | t"
            [attr.aria-label]="'console.audit.filterTarget' | t"
            [ngModel]="targetDraft()"
            (ngModelChange)="targetDraft.set($event)"
            (keydown.enter)="applyFilter()"
          />
        </label>
        <button type="button" class="btn" (click)="applyFilter()">
          {{ 'console.audit.filterTarget' | t }}
        </button>
        @if (targetId()) {
          <button type="button" class="btn" (click)="clearFilter()">
            {{ 'console.audit.clearFilter' | t }}
          </button>
        }
      </div>
    </header>

    @if (state() === 'ready') {
      <div class="card">
        <console-audit-table [events]="events()" [directory]="directory()" [detailed]="true" />

        @if (hasMore()) {
          <div class="form-actions">
            <button type="button" class="btn" [disabled]="loadingMore()" (click)="loadMore()">
              {{ (loadingMore() ? 'console.audit.loadingMore' : 'console.audit.loadMore') | t }}
            </button>
          </div>
        }
      </div>
    } @else {
      <console-state-block
        [state]="state()"
        [error]="error()"
        [emptyTitle]="'console.audit.empty' | t"
        [emptyHelp]="'console.audit.emptyHelp' | t"
        (retry)="reload()"
      />
    }
  `,
})
export class AuditPageComponent {
  private readonly api = inject(ConsoleApiService);
  private readonly i18n = inject(I18nService);

  protected readonly events = signal<AuditView[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal('');
  protected readonly targetDraft = signal('');
  protected readonly targetId = signal('');
  /** A short last batch means the log is exhausted, so the button disappears. */
  protected readonly hasMore = signal(false);
  /** Names for the identifiers in the log; without them every row is a pair of opaque ids. */
  protected readonly directory = signal<NameDirectory>(EMPTY_NAME_DIRECTORY);

  protected readonly state = computed<PageState>(() => {
    if (this.loading()) return 'loading';
    if (this.error()) return 'error';
    return this.events().length === 0 ? 'empty' : 'ready';
  });

  constructor() {
    void this.load();
  }

  protected reload(): void {
    void this.load();
  }

  protected applyFilter(): void {
    this.targetId.set(this.targetDraft().trim());
    void this.load();
  }

  protected clearFilter(): void {
    this.targetDraft.set('');
    this.targetId.set('');
    void this.load();
  }

  protected async loadMore(): Promise<void> {
    const oldest = this.events().at(-1);
    if (!oldest || this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    try {
      const batch = await this.api.listAudit({
        limit: PAGE_SIZE,
        before: oldest.id,
        targetId: this.targetId() || undefined,
      });
      this.events.update((events) => [...events, ...batch]);
      this.hasMore.set(batch.length === PAGE_SIZE);
    } catch (error) {
      this.error.set(
        this.i18n.t('console.common.loadFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.loadingMore.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      // One round trip's worth of latency for all three: the log is unreadable on its own.
      const [batch, users, devices] = await Promise.all([
        this.api.listAudit({ limit: PAGE_SIZE, targetId: this.targetId() || undefined }),
        this.api.listUsers(),
        this.api.listAllDevices(),
      ]);
      this.events.set(batch);
      this.directory.set(buildNameDirectory(users, devices));
      this.hasMore.set(batch.length === PAGE_SIZE);
    } catch (error) {
      this.error.set(
        this.i18n.t('console.common.loadFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.loading.set(false);
    }
  }
}
