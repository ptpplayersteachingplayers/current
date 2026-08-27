/**
 * Book a training session.
 *
 * -----------------------------------------------------------------------------
 * Pick a day, pick a time, confirm. The screen holds a trainer id, a slot start
 * time and a player id — never a price. Prices shown come from the server's
 * slot response; the amount charged is derived server-side from the trainer's
 * rate and the slot length.
 *
 * Payment deliberately hands off to the web checkout rather than completing
 * in-app. One payment path for web and mobile is what keeps the two from
 * drifting into separate, separately-buggy implementations.
 * -----------------------------------------------------------------------------
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { EmptyState, ErrorState, PrimaryButton } from '../components';
import { useHoldSlot, useMyPlayers, useTrainer, useTrainerSlots } from '../hooks/useTraining';
import { borderRadius, colors, spacing } from '../theme';
import type { Slot } from '../api/training';

interface Props {
  route: { params: { trainerId: number } };
  navigation: { goBack: () => void };
}

export default function BookSessionScreen({ route }: Props) {
  const { trainerId } = route.params;

  const trainer = useTrainer(trainerId);
  const slots = useTrainerSlots(trainerId);
  const players = useMyPlayers();
  const hold = useHoldSlot(trainerId);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);

  const days = slots.data ?? [];

  // Default to the first day that actually has availability.
  const activeDate = selectedDate ?? days[0]?.date ?? null;

  const activeSlots = useMemo(
    () => days.find((day) => day.date === activeDate)?.slots ?? [],
    [days, activeDate]
  );

  const playerId = selectedPlayer ?? players.data?.[0]?.id ?? 0;

  const priceFor = (slot: Slot) => {
    const hourly = trainer.data?.hourlyCents ?? 0;
    return `$${Math.round((hourly * slot.minutes) / 60 / 100)}`;
  };

  const confirm = () => {
    if (!selectedSlot) return;

    hold.mutate(
      { startsAt: selectedSlot.startsAt, playerId },
      {
        // The server decides where checkout lives; we just follow it.
        onSuccess: (result) => Linking.openURL(result.checkoutUrl),
      }
    );
  };

  if (slots.isLoading || trainer.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (slots.isError) {
    return <ErrorState message="We couldn't load available times." onRetry={slots.refetch} />;
  }

  if (days.length === 0) {
    return (
      <EmptyState
        title="No times available"
        message={`${trainer.data?.name ?? 'This trainer'} has no open sessions in the next few weeks.`}
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{trainer.data?.name}</Text>

      {/* Day selector */}
      <Text style={styles.label}>Choose a day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayRow}>
        {days.map((day) => {
          const active = day.date === activeDate;
          return (
            <TouchableOpacity
              key={day.date}
              style={[styles.dayChip, active && styles.dayChipActive]}
              onPress={() => {
                setSelectedDate(day.date);
                setSelectedSlot(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>
                {formatDay(day.date)}
              </Text>
              <Text style={styles.dayChipCount}>
                {day.slots.length} {day.slots.length === 1 ? 'time' : 'times'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Time selector */}
      <Text style={styles.label}>Choose a time</Text>
      <View style={styles.slotGrid}>
        {activeSlots.map((slot) => {
          const active = selectedSlot?.startsAt === slot.startsAt;
          return (
            <TouchableOpacity
              key={slot.startsAt}
              style={[styles.slot, active && styles.slotActive]}
              onPress={() => setSelectedSlot(slot)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={styles.slotTime}>{formatTime(slot.startsAt)}</Text>
              <Text style={styles.slotMeta}>
                {slot.minutes} min · {priceFor(slot)}
              </Text>
              {slot.location ? <Text style={styles.slotMeta}>{slot.location}</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Player selector — only when there is a choice to make */}
      {(players.data?.length ?? 0) > 1 && (
        <>
          <Text style={styles.label}>Who is training?</Text>
          <View style={styles.slotGrid}>
            {players.data?.map((player) => {
              const active = playerId === player.id;
              return (
                <TouchableOpacity
                  key={player.id}
                  style={[styles.slot, active && styles.slotActive]}
                  onPress={() => setSelectedPlayer(player.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={styles.slotTime}>{player.firstName}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {hold.isError && (
        <Text style={styles.error}>
          That time was just taken. Pick another and try again.
        </Text>
      )}

      <PrimaryButton
        title={hold.isPending ? 'Holding your slot…' : 'Continue to payment'}
        onPress={confirm}
        disabled={!selectedSlot || hold.isPending}
      />
    </ScrollView>
  );
}

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatTime(startsAt: string): string {
  return new Date(startsAt.replace(' ', 'T')).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.offWhite },
  content: { padding: spacing.lg, gap: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.md,
  },
  dayRow: { flexGrow: 0 },
  dayChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  dayChipActive: { borderColor: colors.primary, backgroundColor: '#FEF3C7' },
  dayChipText: { fontWeight: '700', color: colors.ink },
  dayChipTextActive: { color: colors.ink },
  dayChipCount: { fontSize: 12, color: colors.gray },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: {
    minWidth: 104,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  slotActive: { borderColor: colors.primary, backgroundColor: '#FEF3C7' },
  slotTime: { fontSize: 16, fontWeight: '700', color: colors.ink },
  slotMeta: { fontSize: 12, color: colors.gray },
  error: { color: colors.error, fontSize: 14 },
});
