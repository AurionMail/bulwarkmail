"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ContactCard } from "@/lib/jmap/types";
import { getContactDisplayName, getContactPrimaryEmail, type DirectoryEntry } from "@/stores/contact-store";
import { PrintRoot } from "@/components/print/print-root";
import { cachedPhotoUri, contactSheetSections } from "./contact-print";

function primaryPhone(contact: ContactCard): string {
  return contact.phones ? Object.values(contact.phones)[0]?.number || "" : "";
}

function primaryOrganization(contact: ContactCard): string {
  return contact.organizations ? Object.values(contact.organizations)[0]?.name || "" : "";
}

function Initial({ name }: { name: string }) {
  return <div className="pr-photo is-placeholder" aria-hidden>{(name.trim() || "?").charAt(0).toLocaleUpperCase()}</div>;
}

/** One contact on a sheet: photo, name, then every field of the contact page. */
export function ContactPrintSheet({ contact, photoUri }: { contact: ContactCard; photoUri?: string }) {
  const t = useTranslations("contacts");
  const locale = useLocale();
  const name = getContactDisplayName(contact) || t("detail.section_contact");
  const photo = photoUri ?? cachedPhotoUri(contact);
  const subtitle = [
    ...Object.values(contact.titles ?? {}).filter((title) => title.kind !== "role").map((title) => title.name),
    primaryOrganization(contact) === name ? "" : primaryOrganization(contact),
  ].filter(Boolean).join(" · ");
  return (
    <PrintRoot orientation="portrait" title={name}>
      <article className="pr-sheet">
        <header className="pr-sheet-head">
          {photo ? <img className="pr-photo" src={photo} alt="" /> : <Initial name={name} />}
          <div>
            <h1><bdi>{name}</bdi></h1>
            {subtitle && <p className="pr-sheet-sub"><bdi>{subtitle}</bdi></p>}
          </div>
        </header>
        {contactSheetSections(contact, t, locale).map((section) => (
          <section key={section.title} className={section.text ? "pr-flow" : undefined}>
            <h2>{section.title}</h2>
            {section.text ? (
              section.rows.map((row, i) => <p key={i} className="pr-text" dir="auto">{row.value}</p>)
            ) : (
              <dl className="pr-dl">
                {section.rows.map((row, i) => (
                  <div key={i} style={{ display: "contents" }}>
                    <dt><bdi>{row.label}</bdi></dt>
                    <dd className="pr-text"><bdi>{row.value}</bdi></dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ))}
      </article>
    </PrintRoot>
  );
}

/** A group: its name and a table of its members. */
export function ContactGroupPrintSheet({ group, members }: { group: ContactCard; members: ContactCard[] }) {
  const t = useTranslations("contacts");
  const name = getContactDisplayName(group);
  return (
    <PrintRoot orientation="portrait" title={name}>
      <article className="pr-sheet">
        <header className="pr-sheet-head">
          <div>
            <h1><bdi>{name}</bdi></h1>
            <p className="pr-sheet-sub">{t("groups.member_count", { count: members.length })}</p>
          </div>
        </header>
        <section className="pr-flow">
          <h2>{t("groups.members_label")}</h2>
          {members.map((member) => (
            <div key={member.id} className="pr-list-row pr-member-row">
              <span className="pr-contact-name"><bdi>{getContactDisplayName(member)}</bdi></span>
              <span><bdi>{getContactPrimaryEmail(member)}</bdi></span>
              <span><bdi>{primaryPhone(member)}</bdi></span>
            </div>
          ))}
        </section>
      </article>
    </PrintRoot>
  );
}

/** A directory entry: name, kind and address. */
export function DirectoryEntryPrintSheet({ entry }: { entry: DirectoryEntry }) {
  const t = useTranslations("contacts.directory");
  return (
    <PrintRoot orientation="portrait" title={entry.name}>
      <article className="pr-sheet">
        <header className="pr-sheet-head">
          <Initial name={entry.name} />
          <div>
            <h1><bdi>{entry.name}</bdi></h1>
            {entry.type && <p className="pr-sheet-sub">{t(`type.${entry.type}`)}</p>}
          </div>
        </header>
        <section>
          <dl className="pr-dl">
            <dt>{t("email")}</dt>
            <dd><bdi>{entry.email}</bdi></dd>
          </dl>
        </section>
      </article>
    </PrintRoot>
  );
}

export interface ContactListPrintProps {
  /** The address book, group or category the list shows. */
  title: string;
  contacts: ContactCard[];
  /** Letter groups, when the list is grouped on screen. */
  sections?: { letter: string; items: ContactCard[] }[] | null;
  searchQuery?: string;
}

/** The list on screen as a compact directory: name, email, phone, organization. */
export function ContactListPrint({ title, contacts, sections, searchQuery }: ContactListPrintProps) {
  const t = useTranslations("contacts");
  const columns = { gridTemplateColumns: "27% 31% 18% minmax(0, 1fr)" };
  const row = (contact: ContactCard) => (
    <div key={contact.id} className="pr-list-row pr-contact-row" style={columns}>
      <span className="pr-contact-name"><bdi>{getContactDisplayName(contact)}</bdi></span>
      <span><bdi>{getContactPrimaryEmail(contact)}</bdi></span>
      <span><bdi>{primaryPhone(contact)}</bdi></span>
      <span><bdi>{primaryOrganization(contact)}</bdi></span>
    </div>
  );
  const groups = sections ?? [{ letter: "", items: contacts }];
  return (
    <PrintRoot orientation="portrait" title={title}>
      <header className="pr-header">
        <h1 className="pr-title"><bdi>{title}</bdi></h1>
        <p className="pr-meta">
          <span>{t("print.count", { count: contacts.length })}</span>
          {searchQuery?.trim() && (
            <>
              <span className="pr-meta-sep" aria-hidden>·</span>
              <span><bdi>{t("print.search", { query: searchQuery.trim() })}</bdi></span>
            </>
          )}
        </p>
      </header>
      <div className="pr-column-heads" style={columns}>
        <span>{t("print.name")}</span>
        <span>{t("detail.email_default_label")}</span>
        <span>{t("detail.phone_default_label")}</span>
        <span>{t("detail.organization_label")}</span>
      </div>
      {groups.map(({ letter, items }) => {
        const [first, ...rest] = items;
        if (!first) return null;
        return (
          <section key={letter || "all"}>
            {/* A letter heading stays with its first row: never alone at a page's foot. */}
            <div className="pr-keep">
              {letter && <h2 className="pr-letter">{letter}</h2>}
              {row(first)}
            </div>
            {rest.map(row)}
          </section>
        );
      })}
    </PrintRoot>
  );
}

/** The directory (or the part a search left) as a list. */
export function DirectoryListPrint({ entries, searchQuery }: { entries: DirectoryEntry[]; searchQuery?: string }) {
  const t = useTranslations("contacts");
  const title = t("directory.title");
  const columns = { gridTemplateColumns: "40% 40% minmax(0, 1fr)" };
  return (
    <PrintRoot orientation="portrait" title={title}>
      <header className="pr-header">
        <h1 className="pr-title">{title}</h1>
        <p className="pr-meta">
          <span>{t("print.entries", { count: entries.length })}</span>
          {searchQuery?.trim() && (
            <>
              <span className="pr-meta-sep" aria-hidden>·</span>
              <span><bdi>{t("print.search", { query: searchQuery.trim() })}</bdi></span>
            </>
          )}
        </p>
      </header>
      <div className="pr-column-heads" style={columns}>
        <span>{t("print.name")}</span>
        <span>{t("directory.email")}</span>
        <span />
      </div>
      {entries.map((entry) => (
        <div key={entry.email} className="pr-list-row pr-contact-row" style={columns}>
          <span className="pr-contact-name"><bdi>{entry.name}</bdi></span>
          <span><bdi>{entry.email}</bdi></span>
          <span>{entry.type ? t(`directory.type.${entry.type}`) : ""}</span>
        </div>
      ))}
    </PrintRoot>
  );
}
