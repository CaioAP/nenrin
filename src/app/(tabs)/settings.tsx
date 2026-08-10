import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Chip } from '@/components/chip';
import { DebugTools } from '@/components/debug-tools';
import { NotificationPermission } from '@/components/notification-permission';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSettings } from '@/db/hooks';
import { updateSettings } from '@/db/settings';
import { LEAP_DAY_POLICIES } from '@/domain/birthday';
import {
  type AppSettings,
  describeLeadDays,
  describeLeapDayPolicy,
  formatTimeOfDay,
  isPresetTime,
  LEAD_DAY_CHOICES,
  NOTIFY_TIME_CHOICES,
  parseTimeOfDay,
  type TimeDraft,
  type TimeErrors,
} from '@/domain/settings';
import { useTheme } from '@/hooks/use-theme';

/**
 * Everything here writes straight through `updateSettings` with no save button.
 *
 * The reminder window re-arms itself off the settings row, so a change is live the moment
 * it lands — a Save step would only add a way to lose the change. The one exception is the
 * custom time, which cannot be applied until it parses.
 */
export default function SettingsScreen() {
  const { settings } = useSettings();

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <NotificationPermission />

        <Section
          title="Remind me"
          hint="How far ahead of a birthday to be told, unless a person overrides it."
        >
          {LEAD_DAY_CHOICES.map((days) => (
            <Chip
              key={days}
              label={describeLeadDays(days)}
              selected={settings.defaultLeadDays === days}
              onPress={() => updateSettings({ defaultLeadDays: days })}
            />
          ))}
        </Section>

        <NotifyTime settings={settings} />

        <Section
          title="29 February birthdays"
          hint="Which day to celebrate on in the three years out of four that have no 29th."
        >
          {LEAP_DAY_POLICIES.map((policy) => (
            <Chip
              key={policy}
              label={describeLeapDayPolicy(policy)}
              selected={settings.leapDayPolicy === policy}
              onPress={() => updateSettings({ leapDayPolicy: policy })}
            />
          ))}
        </Section>

        <ThemedText type="small" themeColor="textSecondary">
          Nenrin stores everything on this device. Nothing is sent anywhere.
        </ThemedText>

        <DebugTools />
      </ScrollView>
    </ThemedView>
  );
}

/**
 * The time of day reminders arrive: six shortcuts, plus anything the user wants to type.
 *
 * The shortcuts cover the answer almost everybody wants with one tap. Custom exists because
 * "almost" is not "all" — someone who is up at 05:30, or wants 21:15 specifically, should
 * not be told their preference is unavailable.
 */
function NotifyTime({ settings }: { settings: AppSettings }) {
  const theme = useTheme();
  const isCustom = !isPresetTime(settings.notifyHour, settings.notifyMinute);

  // Open whenever the saved time is not one of the chips, so a custom time is always
  // visible and editable rather than hidden behind a chip that looks unselected.
  const [editing, setEditing] = useState(isCustom);
  const [draft, setDraft] = useState<TimeDraft>({
    hour: String(settings.notifyHour),
    minute: String(settings.notifyMinute),
  });
  const [errors, setErrors] = useState<TimeErrors>({});

  const choosePreset = (hour: number) => {
    setEditing(false);
    setErrors({});
    updateSettings({ notifyHour: hour, notifyMinute: 0 });
  };

  const startEditing = () => {
    // Seeded from what is actually saved, so opening Custom on 09:00 offers 9 and 0 to edit
    // rather than whatever was last typed and abandoned.
    setDraft({ hour: String(settings.notifyHour), minute: String(settings.notifyMinute) });
    setErrors({});
    setEditing(true);
  };

  const save = () => {
    const parsed = parseTimeOfDay(draft);
    if (!parsed.ok) return setErrors(parsed.errors);

    setErrors({});
    updateSettings({ notifyHour: parsed.value.hour, notifyMinute: parsed.value.minute });
  };

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">At</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        The time of day reminders arrive.
      </ThemedText>

      <View style={styles.choices}>
        {NOTIFY_TIME_CHOICES.map((hour) => (
          <Chip
            key={hour}
            label={formatTimeOfDay(hour, 0)}
            selected={!isCustom && settings.notifyHour === hour}
            onPress={() => choosePreset(hour)}
          />
        ))}
        <Chip
          label={isCustom ? formatTimeOfDay(settings.notifyHour, settings.notifyMinute) : 'Custom'}
          selected={isCustom}
          accessibilityLabel="Custom time"
          onPress={startEditing}
        />
      </View>

      {editing ? (
        <View style={styles.timeRow}>
          <TimePart
            label="Hour"
            value={draft.hour}
            max={2}
            onChange={(hour) => setDraft({ ...draft, hour })}
          />
          <ThemedText type="subtitle" style={{ color: theme.textSecondary }}>
            :
          </ThemedText>
          <TimePart
            label="Minute"
            value={draft.minute}
            max={2}
            onChange={(minute) => setDraft({ ...draft, minute })}
          />
          <ActionButton label="Set" onPress={save} />
        </View>
      ) : null}

      <FieldError message={errors.hour} />
      <FieldError message={errors.minute} />
    </View>
  );
}

function TimePart({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (next: string) => void;
}) {
  const theme = useTheme();

  return (
    <TextInput
      value={value}
      // Digits only, and capped at two, so the field cannot hold something no validation
      // message could explain.
      onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, max))}
      accessibilityLabel={label}
      keyboardType="number-pad"
      selectTextOnFocus
      style={[styles.timeInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
    />
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <ThemedText type="small" accessibilityRole="alert" themeColor="danger">
      {message}
    </ThemedText>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {hint}
      </ThemedText>
      <View style={styles.choices}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  section: { gap: Spacing.two },
  // Wraps rather than scrolls: unlike the day picker these sets are short, and a row that
  // scrolls without looking scrollable hides options.
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  timeInput: {
    width: 56,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: Spacing.two,
    fontSize: 16,
    textAlign: 'center',
  },
});
