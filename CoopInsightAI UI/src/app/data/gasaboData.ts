// Gasabo District Sectors and Cells

export const GASABO_SECTORS = [
  { id: "bumbogo", name: "Bumbogo" },
  { id: "gatsata", name: "Gatsata" },
  { id: "jali", name: "Jali" },
  { id: "gikomero", name: "Gikomero" },
  { id: "gisozi", name: "Gisozi" },
  { id: "jabana", name: "Jabana" },
  { id: "kacyiru", name: "Kacyiru" },
  { id: "kimihurura", name: "Kimihurura" },
  { id: "kimironko", name: "Kimironko" },
  { id: "kinyinya", name: "Kinyinya" },
  { id: "ndera", name: "Ndera" },
  { id: "nduba", name: "Nduba" },
  { id: "remera", name: "Remera" },
  { id: "rusororo", name: "Rusororo" },
  { id: "rutunga", name: "Rutunga" },
];

export const SECTOR_CELLS: Record<string, string[]> = {
  bumbogo: ["Bumbogo", "Bukali", "Musezero", "Rwamiko"],
  gatsata: ["Gatsata", "Karuruma", "Rubirizi"],
  jali: ["Jali", "Bukinanyana", "Nyagahinga", "Rusororo"],
  gikomero: ["Gikomero", "Gasagara", "Murambi", "Nyagasambu"],
  gisozi: ["Gisozi", "Akabahizi", "Kabutare", "Kiyovu"],
  jabana: ["Jabana", "Gishushu", "Nyabisindu", "Rugando"],
  kacyiru: ["Kacyiru", "Kamatamu", "Kamutwa", "Kavumu"],
  kimihurura: ["Kimihurura", "Bibare", "Kibagabaga", "Kimihurura"],
  kimironko: ["Kimironko", "Biryogo", "Kibagabaga", "Nyabikenke"],
  kinyinya: ["Kinyinya", "Gacuriro", "Kabuye", "Nemba"],
  ndera: ["Ndera", "Busanza", "Kinyinya", "Ndera"],
  nduba: ["Nduba", "Gahanga", "Masaka", "Mataba"],
  remera: ["Remera", "Gikondo", "Kigugu", "Nyarutarama"],
  rusororo: ["Rusororo", "Gasave", "Mimuri", "Rutunga"],
  rutunga: ["Rutunga", "Kinyange", "Mushitsi", "Rutunga"],
};

export const COOPERATIVE_TYPES = [
  "Agriculture",
  "Livestock",
  "Handicrafts",
  "Services",
  "Trading",
  "Transport",
  "Construction",
  "Carpentry",
  "Dairy",
  "Coffee",
  "Tea",
  "Honey Production",
  "Poultry",
];

export const ACTIVITY_TYPES = [
  { id: "meeting", name: "Meeting", icon: "Users" },
  { id: "training", name: "Training", icon: "GraduationCap" },
  { id: "production", name: "Production", icon: "Factory" },
  { id: "sales", name: "Sales", icon: "ShoppingCart" },
  { id: "distribution", name: "Distribution", icon: "Truck" },
  { id: "planning", name: "Planning", icon: "Calendar" },
];

export const TRANSACTION_CATEGORIES = [
  { id: "member_contribution", name: "Member Contribution", type: "income" },
  { id: "product_sales", name: "Product Sales", type: "income" },
  { id: "loan_repayment", name: "Loan Repayment", type: "income" },
  { id: "grant", name: "Grant/Donation", type: "income" },
  { id: "investment_return", name: "Investment Return", type: "income" },
  { id: "operational_expense", name: "Operational Expense", type: "expense" },
  { id: "equipment_purchase", name: "Equipment Purchase", type: "expense" },
  { id: "training_expense", name: "Training Expense", type: "expense" },
  { id: "loan_disbursement", name: "Loan Disbursement", type: "expense" },
  { id: "administrative_cost", name: "Administrative Cost", type: "expense" },
  { id: "transport", name: "Transport", type: "expense" },
  { id: "utilities", name: "Utilities", type: "expense" },
];
